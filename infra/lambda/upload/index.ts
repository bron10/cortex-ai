import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

const dynamodbClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new S3Client({});
const eventbridge = new EventBridgeClient({});

const DATA_TABLE_NAME = process.env.DATA_TABLE_NAME!;
const DATA_BUCKET_NAME = process.env.DATA_BUCKET_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const ENABLE_AI_INSIGHTS = process.env.ENABLE_AI_INSIGHTS === 'true';

interface UploadRequest {
  tenantId: string;
  data: any;
  metadata?: Record<string, any>;
}

interface UploadResponse {
  success: boolean;
  dataId: string;
  message: string;
  tenantId: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Upload function triggered:', JSON.stringify(event, null, 2));

    // Parse request body first
    let requestBody: UploadRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({
          success: false,
          message: 'Invalid JSON in request body',
        }),
      };
    }

    // Extract tenant ID from the authenticated user's context
    // The Cognito authorizer adds user information to the request context
    const userContext = event.requestContext.authorizer?.claims;
    const tenantId = userContext?.['custom:tenantId'] || 
                     userContext?.['tenantId'] ||
                     requestBody.tenantId || 
                     event.headers['X-Tenant-ID'];
    
    if (!tenantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({
          success: false,
          message: 'User must have tenantId in their Cognito user attributes or provide it in request body/header',
        }),
      };
    }

    // Validate request
    if (!requestBody.data) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({
          success: false,
          message: 'data is required',
        }),
      };
    }

    // Generate unique data ID
    const dataId = uuidv4();
    const timestamp = new Date().toISOString();
    const s3Key = `${tenantId}/${dataId}.json`;

    // Store data in S3
    await s3.send(new PutObjectCommand({
      Bucket: DATA_BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(requestBody.data),
      ContentType: 'application/json',
      Metadata: {
        tenantId,
        timestamp,
        dataId,
      },
    }));

    // Store metadata in DynamoDB
    const metadataItem = {
      tenantId,
      dataId,
      s3Key,
      timestamp,
      status: 'UPLOADED',
      metadata: requestBody.metadata || {},
      ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year TTL
    };

    await dynamodb.send(new PutCommand({
      TableName: DATA_TABLE_NAME,
      Item: metadataItem,
    }));

    // Emit event for processing
    await eventbridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'cortex-ai.upload',
          DetailType: 'DataUploaded',
          Detail: JSON.stringify({
            tenantId,
            dataId,
            s3Key,
            timestamp,
            metadata: requestBody.metadata,
          }),
          EventBusName: EVENT_BUS_NAME,
        },
      ],
    }));

    console.log(`Data uploaded successfully: ${dataId} for tenant: ${tenantId}`);

    const response: UploadResponse = {
      success: true,
      dataId,
      message: 'Data uploaded successfully',
      tenantId,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in upload function:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      }),
    };
  }
};
