import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Initialize AWS SDK v3 clients
const dynamodb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodb);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Get all files for the authenticated user (no tenant filtering)
    // The Cognito authorizer ensures only authenticated users can access this endpoint
    const userContext = event.requestContext.authorizer?.claims;
    console.log('User context:', userContext);
    
    // Scan DynamoDB for all files (in a real multi-tenant app, you'd want to add proper access controls)
    const command = new ScanCommand({
      TableName: process.env.DATA_TABLE_NAME!,
    });

    const result = await docClient.send(command);

    // Transform the data for the frontend and sort by timestamp (newest first)
    const files = result.Items?.map(item => ({
      dataId: item.dataId,
      tenantId: item.tenantId,
      timestamp: item.timestamp,
      status: item.status || 'UPLOADED',
      fileName: item.fileName,
      fileSize: item.fileSize,
      uploadedAt: item.uploadedAt,
      processingResults: item.processingResults,
      aiInsights: item.aiInsights,
      insights: item.insights || [], // Include insights history
      lastInsightAt: item.lastInsightAt, // Include last insight timestamp
      insightCount: (item.insights || []).length, // Count of insights
    })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) || [];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        files,
        count: files.length,
      }),
    };

  } catch (error) {
    console.error('Error listing files:', error);
    
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
};
