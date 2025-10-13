import { EventBridgeEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const dynamodbClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new S3Client({});
const eventbridge = new EventBridgeClient({});

const DATA_TABLE_NAME = process.env.DATA_TABLE_NAME!;
const DATA_BUCKET_NAME = process.env.DATA_BUCKET_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const ENABLE_AI_INSIGHTS = process.env.ENABLE_AI_INSIGHTS === 'true';

interface DataUploadedEvent {
  tenantId: string;
  dataId: string;
  s3Key: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface ProcessedData {
  tenantId: string;
  dataId: string;
  s3Key: string;
  timestamp: string;
  status: string;
  processedAt: string;
  processingResults: {
    recordCount?: number;
    dataSize?: number;
    validationStatus: string;
    extractedFields?: string[];
    qualityScore?: number;
  };
  metadata?: Record<string, any>;
  ttl: number;
}

export const handler = async (
  event: EventBridgeEvent<'DataUploaded', DataUploadedEvent>,
  context: Context
): Promise<void> => {
  try {
    console.log('Process function triggered:', JSON.stringify(event, null, 2));

    const { tenantId, dataId, s3Key, timestamp, metadata } = event.detail;

    // Retrieve data from S3 for processing
    const s3Object = await s3.send(new GetObjectCommand({
      Bucket: DATA_BUCKET_NAME,
      Key: s3Key,
    }));

    if (!s3Object.Body) {
      throw new Error('No data found in S3 object');
    }

    const data = JSON.parse(await s3Object.Body.transformToString());
    
    // Process the data based on type
    const processingResults = await processData(data);
    
    // Calculate data size
    const dataSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    
    // Create processed data record
    const processedData: ProcessedData = {
      tenantId,
      dataId,
      s3Key,
      timestamp,
      status: 'PROCESSED',
      processedAt: new Date().toISOString(),
      processingResults: {
        recordCount: Array.isArray(data) ? data.length : 1,
        dataSize,
        validationStatus: 'VALID',
        extractedFields: Object.keys(data),
        qualityScore: calculateQualityScore(data),
        ...processingResults,
      },
      metadata: metadata || {},
      ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year TTL
    };

    // Update DynamoDB record
    await dynamodb.send(new UpdateCommand({
      TableName: DATA_TABLE_NAME,
      Key: {
        tenantId,
        dataId,
      },
      UpdateExpression: 'SET #status = :status, processedAt = :processedAt, processingResults = :processingResults',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'PROCESSED',
        ':processedAt': processedData.processedAt,
        ':processingResults': processedData.processingResults,
      },
    }));

    console.log(`Data processed successfully: ${dataId} for tenant: ${tenantId}`);

    // Emit event for AI insights if enabled
    if (ENABLE_AI_INSIGHTS) {
      await eventbridge.send(new PutEventsCommand({
        Entries: [
          {
            Source: 'cortex-ai.process',
            DetailType: 'DataProcessed',
            Detail: JSON.stringify({
              tenantId,
              dataId,
              s3Key,
              timestamp,
              processedAt: processedData.processedAt,
              processingResults: processedData.processingResults,
              metadata,
            }),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }));
    }

  } catch (error) {
    console.error('Error in process function:', error);
    
    // Update status to PROCESSING_FAILED
    try {
      const { tenantId, dataId } = event.detail;
      await dynamodb.send(new UpdateCommand({
        TableName: DATA_TABLE_NAME,
        Key: {
          tenantId,
          dataId,
        },
        UpdateExpression: 'SET #status = :status, processingError = :error, processedAt = :processedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'PROCESSING_FAILED',
          ':error': (error as Error).message,
          ':processedAt': new Date().toISOString(),
        },
      }));
    } catch (updateError) {
      console.error('Failed to update status to PROCESSING_FAILED:', updateError);
    }
    
    throw error;
  }
};

async function processData(data: any): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  // Generic processing for any data type
  results.recordCount = Array.isArray(data) ? data.length : 1;
  results.extractedFields = Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : Object.keys(data);
  
  // Try to detect common patterns
  if (Array.isArray(data) && data.length > 0) {
    const sample = data[0];
    
    // Check for common fields and calculate metrics
    if (sample.email) {
      results.hasEmail = data.some((item: any) => item.email);
    }
    if (sample.phone) {
      results.hasPhone = data.some((item: any) => item.phone);
    }
    if (sample.amount || sample.price) {
      const amountField = sample.amount ? 'amount' : 'price';
      results.totalAmount = data.reduce((sum: number, item: any) => sum + (item[amountField] || 0), 0);
    }
    if (sample.category) {
      results.categories = [...new Set(data.map((item: any) => item.category).filter(Boolean))];
    }
    if (sample.level) {
      results.errorCount = data.filter((item: any) => item.level === 'error').length;
    }
  }
  
  return results;
}

function calculateQualityScore(data: any): number {
  let score = 100;
  
  if (Array.isArray(data)) {
    if (data.length === 0) score -= 20;
    if (data.length > 1000) score -= 10;
    
    // Check for missing required fields
    const sample = data[0];
    if (sample) {
      score -= calculateMissingFieldsPenalty(sample);
    }
  } else {
    score -= calculateMissingFieldsPenalty(data);
  }
  
  return Math.max(0, score);
}

function calculateMissingFieldsPenalty(item: any): number {
  let penalty = 0;
  
  // Generic penalty calculation for any data type
  if (!item.id && !item.name && !item.title) penalty += 10;
  if (Object.keys(item).length === 0) penalty += 20;
  
  return penalty;
}
