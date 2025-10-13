import { EventBridgeEvent, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const dynamodbClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const DATA_TABLE_NAME = process.env.DATA_TABLE_NAME!;
const DATA_BUCKET_NAME = process.env.DATA_BUCKET_NAME!;

interface DataProcessedEvent {
  tenantId: string;
  dataId: string;
  s3Key: string;
  timestamp: string;
  processedAt: string;
  processingResults: {
    recordCount?: number;
    dataSize?: number;
    validationStatus: string;
    extractedFields?: string[];
    qualityScore?: number;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

interface AIInsights {
  summary: string;
  keyInsights: string[];
  recommendations: string[];
  riskFactors: string[];
  opportunities: string[];
  dataQualityNotes: string[];
  modelUsed: string;
  confidence: number;
}

export const handler = async (
  event: EventBridgeEvent<'DataProcessed', DataProcessedEvent> | APIGatewayProxyEvent,
  context: Context
): Promise<void | APIGatewayProxyResult> => {
  try {
    console.log('Insights function triggered:', JSON.stringify(event, null, 2));

    // Check if this is an API Gateway request
    if ('httpMethod' in event) {
      return await handleApiGatewayRequest(event);
    }

    // Handle EventBridge event
    return await handleEventBridgeEvent(event as EventBridgeEvent<'DataProcessed', DataProcessedEvent>);

  } catch (error) {
    console.error('Error in insights function:', error);
    
    // If it's an API Gateway request, return error response
    if ('httpMethod' in event) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        }),
      };
    }
    
    // For EventBridge events, update error status
    try {
      const { tenantId, dataId } = (event as EventBridgeEvent<'DataProcessed', DataProcessedEvent>).detail;
      await dynamodb.send(new UpdateCommand({
        TableName: DATA_TABLE_NAME,
        Key: {
          tenantId,
          dataId,
        },
        UpdateExpression: 'SET insightsError = :error, insightsGeneratedAt = :timestamp',
        ExpressionAttributeValues: {
          ':error': (error as Error).message,
          ':timestamp': new Date().toISOString(),
        },
      }));
    } catch (updateError) {
      console.error('Failed to update insights error status:', updateError);
    }
    
    throw error;
  }
};

// Rate limiting store (in-memory, resets on cold start)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX_CALLS = 6;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

async function handleApiGatewayRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract parameters from the request
    const dataId = event.queryStringParameters?.dataId;
    const prompt = event.queryStringParameters?.prompt;
    
    if (!dataId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Missing required parameter: dataId',
        }),
      };
    }

    // Validate prompt length
    if (prompt && prompt.length > 100) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Prompt is too long. Maximum length is 100 characters.',
        }),
      };
    }

    // Get user context for rate limiting
    const userContext = event.requestContext.authorizer?.claims;
    const userId = userContext?.sub || userContext?.['cognito:username'] || 'unknown';
    console.log('User context:', JSON.stringify(userContext, null, 2));
    console.log('Rate limiting for user:', userId);
    
    // Check rate limit
    const now = Date.now();
    const userRateLimit = rateLimitStore.get(userId);
    
    if (userRateLimit) {
      if (now < userRateLimit.resetTime) {
        // Within the time window
        if (userRateLimit.count >= RATE_LIMIT_MAX_CALLS) {
          const secondsUntilReset = Math.ceil((userRateLimit.resetTime - now) / 1000);
          console.log(`Rate limit exceeded for user ${userId}. Retry after ${secondsUntilReset} seconds.`);
          return {
            statusCode: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
              'Access-Control-Allow-Methods': 'GET,OPTIONS',
              'Retry-After': secondsUntilReset.toString(),
            },
            body: JSON.stringify({
              error: 'Rate limit exceeded',
              message: `You have exceeded the rate limit of ${RATE_LIMIT_MAX_CALLS} requests per minute. Please try again in ${secondsUntilReset} seconds.`,
              retryAfter: secondsUntilReset,
            }),
          };
        }
        // Increment count
        userRateLimit.count++;
        console.log(`Rate limit count for user ${userId}: ${userRateLimit.count}/${RATE_LIMIT_MAX_CALLS}`);
      } else {
        // Time window expired, reset
        rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        console.log(`Rate limit reset for user ${userId}`);
      }
    } else {
      // First request from this user
      rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      console.log(`First request from user ${userId}`);
    }
    
    // Since we don't have tenant ID in user claims, we need to scan DynamoDB to find the file
    // In a production environment, you'd want to add a GSI on dataId for better performance
    const { Items } = await dynamodb.send(new ScanCommand({
      TableName: DATA_TABLE_NAME,
      FilterExpression: 'dataId = :dataId',
      ExpressionAttributeValues: {
        ':dataId': dataId,
      },
      Limit: 1,
    }));

    if (!Items || Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'File not found',
        }),
      };
    }

    const fileRecord = Items[0];
    const tenantId = fileRecord.tenantId;

    // Retrieve the processed data from S3
    const s3Key = fileRecord.s3Key;
    if (!s3Key) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'No S3 key found for this file',
        }),
      };
    }

    const s3Object = await s3.send(new GetObjectCommand({
      Bucket: DATA_BUCKET_NAME,
      Key: s3Key,
    }));

    if (!s3Object.Body) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Data not found in S3',
        }),
      };
    }

    const data = JSON.parse(await s3Object.Body.transformToString());
    const processingResults = fileRecord.processingResults || {};
    
    // Generate additional insights based on the prompt
    const insights = await generateAdditionalInsights(data, processingResults, prompt);
    
    // Save the insight to DynamoDB (append to insights history)
    const timestamp = new Date().toISOString();
    const insightRecord = {
      timestamp,
      userId,
      prompt: prompt || 'General insights',
      response: insights,
    };

    // Get existing insights array or initialize empty array
    const existingInsights = fileRecord.insights || [];
    
    // Keep only the last 10 insights (configurable)
    const MAX_INSIGHTS = 10;
    const updatedInsights = [...existingInsights, insightRecord].slice(-MAX_INSIGHTS);

    // Update DynamoDB with new insight
    await dynamodb.send(new UpdateCommand({
      TableName: DATA_TABLE_NAME,
      Key: {
        tenantId,
        dataId,
      },
      UpdateExpression: 'SET insights = :insights, lastInsightAt = :timestamp',
      ExpressionAttributeValues: {
        ':insights': updatedInsights,
        ':timestamp': timestamp,
      },
    }));

    console.log(`Insight saved for dataId: ${dataId}, userId: ${userId}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        insights,
        dataId,
        tenantId,
        prompt,
        saved: true,
        insightHistory: updatedInsights,
      }),
    };

  } catch (error) {
    console.error('Error handling API Gateway request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
    };
  }
}

async function handleEventBridgeEvent(event: EventBridgeEvent<'DataProcessed', DataProcessedEvent>): Promise<void> {
    const { 
      tenantId, 
      dataId, 
      s3Key, 
      processingResults, 
      metadata 
    } = event.detail;

    // Retrieve processed data from S3
  const s3Object = await s3.send(new GetObjectCommand({
      Bucket: DATA_BUCKET_NAME,
      Key: s3Key,
  }));

    if (!s3Object.Body) {
      throw new Error('No data found in S3 object');
    }

  const data = JSON.parse(await s3Object.Body.transformToString());
    
    // Generate AI insights using Bedrock
  const insights = await generateAIInsights(data, processingResults, metadata);
    
    // Store insights in DynamoDB
  await dynamodb.send(new UpdateCommand({
      TableName: DATA_TABLE_NAME,
      Key: {
        tenantId,
        dataId,
      },
      UpdateExpression: 'SET aiInsights = :insights, insightsGeneratedAt = :timestamp, #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':insights': insights,
        ':timestamp': new Date().toISOString(),
        ':status': 'INSIGHTS_GENERATED',
      },
  }));

    console.log(`AI insights generated successfully: ${dataId} for tenant: ${tenantId}`);
}

async function generateAdditionalInsights(
  data: any,
  processingResults: any,
  prompt?: string
): Promise<string> {
  try {
    // Create a custom prompt based on user input
    const customPrompt = prompt 
      ? `Based on the following data, please answer this specific question: "${prompt}"\n\nData context:\n${JSON.stringify({
          recordCount: processingResults.recordCount || 0,
          dataSize: processingResults.dataSize || 0,
          qualityScore: processingResults.qualityScore || 0,
          extractedFields: processingResults.extractedFields || [],
          sampleData: Array.isArray(data) ? data.slice(0, 5) : data,
        }, null, 2)}\n\nPlease provide a detailed, actionable response to the question.`
      : `Please analyze the following data and provide key insights:\n\n${JSON.stringify({
          recordCount: processingResults.recordCount || 0,
          dataSize: processingResults.dataSize || 0,
          qualityScore: processingResults.qualityScore || 0,
          extractedFields: processingResults.extractedFields || [],
          sampleData: Array.isArray(data) ? data.slice(0, 5) : data,
        }, null, 2)}`;

    // Use Bedrock to generate insights
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: 0.3,
        system: `You are an expert data analyst. Provide clear, actionable insights based on the data provided. Be specific and practical in your analysis.`,
        messages: [
          {
            role: 'user',
            content: customPrompt,
          },
        ],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body!));
    return responseBody.content[0].text;

  } catch (error) {
    console.error('Bedrock API call failed:', error);
    
    // Fallback response
    return `Analysis completed with fallback method. ${prompt ? `Question: ${prompt}` : 'General analysis'} - Data contains ${processingResults.recordCount || 0} records with quality score of ${processingResults.qualityScore || 'Unknown'}. Consider reviewing the data for business opportunities and potential improvements.`;
  }
}

async function generateAIInsights(
  data: any, 
  processingResults: any, 
  metadata?: Record<string, any>
): Promise<AIInsights> {
  
  // Prepare context for AI model
  const context = buildAnalysisContext(data, processingResults, metadata);
  
  // Create prompt for Bedrock
  const prompt = createAnalysisPrompt(context);
  
  try {
    // Use Claude 3 Sonnet for analysis (you can change this to other models)
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4000,
        temperature: 0.3,
        system: `You are an expert data analyst and business intelligence specialist. 
        Analyze the provided data and generate actionable insights, recommendations, and risk assessments. 
        Be specific, practical, and business-focused in your analysis.`,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body!));
    const content = responseBody.content[0].text;
    
    // Parse the AI response and structure it
    return parseAIResponse(content);
    
  } catch (error) {
    console.error('Bedrock API call failed:', error);
    
    // Fallback to rule-based insights if AI fails
    return generateFallbackInsights(data, processingResults);
  }
}

function buildAnalysisContext(
  data: any, 
  processingResults: any, 
  metadata?: Record<string, any>
): string {
  const context = {
    recordCount: processingResults.recordCount || 0,
    dataSize: processingResults.dataSize || 0,
    qualityScore: processingResults.qualityScore || 0,
    extractedFields: processingResults.extractedFields || [],
    metadata: metadata || {},
    sampleData: Array.isArray(data) ? data.slice(0, 3) : data, // Sample of data for context
    processingResults,
  };
  
  return JSON.stringify(context, null, 2);
}

function createAnalysisPrompt(context: string): string {
  return `Please analyze the following data context and provide comprehensive business insights:

${context}

Please provide your analysis in the following JSON format:
{
  "summary": "A concise summary of the data and its business implications",
  "keyInsights": ["Key insight 1", "Key insight 2", "Key insight 3"],
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],
  "riskFactors": ["Potential risk 1", "Potential risk 2"],
  "opportunities": ["Business opportunity 1", "Business opportunity 2"],
  "dataQualityNotes": ["Data quality observation 1", "Data quality observation 2"],
  "modelUsed": "anthropic.claude-3-sonnet-20240229-v1:0",
  "confidence": 0.85
}

Focus on practical business value, actionable insights, and specific recommendations that could drive business decisions.`;
}

function parseAIResponse(content: string): AIInsights {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || 'AI analysis completed',
        keyInsights: parsed.keyInsights || ['Analysis completed successfully'],
        recommendations: parsed.recommendations || ['Review the data for business opportunities'],
        riskFactors: parsed.riskFactors || ['No immediate risks identified'],
        opportunities: parsed.opportunities || ['Data analysis reveals potential for optimization'],
        dataQualityNotes: parsed.dataQualityNotes || ['Data quality assessment completed'],
        modelUsed: parsed.modelUsed || 'anthropic.claude-3-sonnet-20240229-v1:0',
        confidence: parsed.confidence || 0.8,
      };
    }
  } catch (error) {
    console.warn('Failed to parse AI response as JSON, using fallback parsing:', error);
  }
  
  // Fallback parsing if JSON extraction fails
  return {
    summary: content.substring(0, 200) + '...',
    keyInsights: ['AI analysis completed', 'Review the full response for details'],
    recommendations: ['Consider the AI-generated insights for decision making'],
    riskFactors: ['No specific risks identified in the analysis'],
    opportunities: ['Data analysis provides insights for business optimization'],
    dataQualityNotes: ['AI analysis completed successfully'],
    modelUsed: 'anthropic.claude-3-sonnet-20240229-v1:0',
    confidence: 0.7,
  };
}

function generateFallbackInsights(
  data: any, 
  processingResults: any
): AIInsights {
  const insights: AIInsights = {
    summary: `Fallback analysis for data with ${processingResults.recordCount || 0} records`,
    keyInsights: [
      `Data contains ${processingResults.recordCount || 0} records`,
      `Data quality score: ${processingResults.qualityScore || 'Unknown'}`,
      `Data size: ${(processingResults.dataSize || 0) / 1024} KB`,
    ],
    recommendations: [
      'Review data quality and completeness',
      'Consider implementing data validation rules',
      'Monitor data processing performance',
    ],
    riskFactors: [
      'Fallback analysis used due to AI service unavailability',
      'Limited insight depth compared to AI analysis',
    ],
    opportunities: [
      'Implement automated data quality checks',
      'Set up regular data processing monitoring',
      'Consider data enrichment strategies',
    ],
    dataQualityNotes: [
      `Quality score: ${processingResults.qualityScore || 'Unknown'}`,
      `Fields extracted: ${(processingResults.extractedFields || []).join(', ')}`,
    ],
    modelUsed: 'fallback-rule-based',
    confidence: 0.6,
  };
  
  return insights;
}
