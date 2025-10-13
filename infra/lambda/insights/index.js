"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const dynamodbClient = new client_dynamodb_1.DynamoDBClient({});
const dynamodb = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new client_s3_1.S3Client({});
const bedrock = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const DATA_TABLE_NAME = process.env.DATA_TABLE_NAME;
const DATA_BUCKET_NAME = process.env.DATA_BUCKET_NAME;
const handler = async (event, context) => {
    try {
        console.log('Insights function triggered:', JSON.stringify(event, null, 2));
        // Check if this is an API Gateway request
        if ('httpMethod' in event) {
            return await handleApiGatewayRequest(event);
        }
        // Handle EventBridge event
        return await handleEventBridgeEvent(event);
    }
    catch (error) {
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
            const { tenantId, dataId } = event.detail;
            await dynamodb.send(new lib_dynamodb_1.UpdateCommand({
                TableName: DATA_TABLE_NAME,
                Key: {
                    tenantId,
                    dataId,
                },
                UpdateExpression: 'SET insightsError = :error, insightsGeneratedAt = :timestamp',
                ExpressionAttributeValues: {
                    ':error': error.message,
                    ':timestamp': new Date().toISOString(),
                },
            }));
        }
        catch (updateError) {
            console.error('Failed to update insights error status:', updateError);
        }
        throw error;
    }
};
exports.handler = handler;
// Rate limiting store (in-memory, resets on cold start)
const rateLimitStore = new Map();
const RATE_LIMIT_MAX_CALLS = 6;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
async function handleApiGatewayRequest(event) {
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
            }
            else {
                // Time window expired, reset
                rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
                console.log(`Rate limit reset for user ${userId}`);
            }
        }
        else {
            // First request from this user
            rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
            console.log(`First request from user ${userId}`);
        }
        // Since we don't have tenant ID in user claims, we need to scan DynamoDB to find the file
        // In a production environment, you'd want to add a GSI on dataId for better performance
        const { Items } = await dynamodb.send(new lib_dynamodb_1.ScanCommand({
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
        const s3Object = await s3.send(new client_s3_1.GetObjectCommand({
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
        await dynamodb.send(new lib_dynamodb_1.UpdateCommand({
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
    }
    catch (error) {
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
async function handleEventBridgeEvent(event) {
    const { tenantId, dataId, s3Key, processingResults, metadata } = event.detail;
    // Retrieve processed data from S3
    const s3Object = await s3.send(new client_s3_1.GetObjectCommand({
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
    await dynamodb.send(new lib_dynamodb_1.UpdateCommand({
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
async function generateAdditionalInsights(data, processingResults, prompt) {
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
        const response = await bedrock.send(new client_bedrock_runtime_1.InvokeModelCommand({
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
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.content[0].text;
    }
    catch (error) {
        console.error('Bedrock API call failed:', error);
        // Fallback response
        return `Analysis completed with fallback method. ${prompt ? `Question: ${prompt}` : 'General analysis'} - Data contains ${processingResults.recordCount || 0} records with quality score of ${processingResults.qualityScore || 'Unknown'}. Consider reviewing the data for business opportunities and potential improvements.`;
    }
}
async function generateAIInsights(data, processingResults, metadata) {
    // Prepare context for AI model
    const context = buildAnalysisContext(data, processingResults, metadata);
    // Create prompt for Bedrock
    const prompt = createAnalysisPrompt(context);
    try {
        // Use Claude 3 Sonnet for analysis (you can change this to other models)
        const response = await bedrock.send(new client_bedrock_runtime_1.InvokeModelCommand({
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
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const content = responseBody.content[0].text;
        // Parse the AI response and structure it
        return parseAIResponse(content);
    }
    catch (error) {
        console.error('Bedrock API call failed:', error);
        // Fallback to rule-based insights if AI fails
        return generateFallbackInsights(data, processingResults);
    }
}
function buildAnalysisContext(data, processingResults, metadata) {
    const context = {
        recordCount: processingResults.recordCount || 0,
        dataSize: processingResults.dataSize || 0,
        qualityScore: processingResults.qualityScore || 0,
        extractedFields: processingResults.extractedFields || [],
        metadata: metadata || {},
        sampleData: Array.isArray(data) ? data.slice(0, 3) : data,
        processingResults,
    };
    return JSON.stringify(context, null, 2);
}
function createAnalysisPrompt(context) {
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
function parseAIResponse(content) {
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
    }
    catch (error) {
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
function generateFallbackInsights(data, processingResults) {
    const insights = {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQXVHO0FBQ3ZHLGtEQUFnRTtBQUNoRSw0RUFBMkY7QUFFM0YsTUFBTSxjQUFjLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzlDLE1BQU0sUUFBUSxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUM3RCxNQUFNLEVBQUUsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDNUIsTUFBTSxPQUFPLEdBQUcsSUFBSSw2Q0FBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBRTVGLE1BQU0sZUFBZSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZ0IsQ0FBQztBQUNyRCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWlCLENBQUM7QUE4QmhELE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBbUYsRUFDbkYsT0FBZ0IsRUFDdUIsRUFBRTtJQUN6QyxJQUFJO1FBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUU1RSwwQ0FBMEM7UUFDMUMsSUFBSSxZQUFZLElBQUksS0FBSyxFQUFFO1lBQ3pCLE9BQU8sTUFBTSx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsQ0FBQztTQUM3QztRQUVELDJCQUEyQjtRQUMzQixPQUFPLE1BQU0sc0JBQXNCLENBQUMsS0FBOEQsQ0FBQyxDQUFDO0tBRXJHO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFF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SztTQUM1RDtRQUNELGVBQWUsRUFBRTtZQUNmLHNDQUFzQztZQUN0Qyw2Q0FBNkM7WUFDN0MscUNBQXFDO1NBQ3RDO1FBQ0QsV0FBVyxFQUFFO1lBQ1gseURBQXlEO1lBQ3pELCtDQUErQztTQUNoRDtRQUNELGFBQWEsRUFBRTtZQUNiLHlDQUF5QztZQUN6QywyQ0FBMkM7WUFDM0MscUNBQXFDO1NBQ3RDO1FBQ0QsZ0JBQWdCLEVBQUU7WUFDaEIsa0JBQWtCLGlCQUFpQixDQUFDLFlBQVksSUFBSSxTQUFTLEVBQUU7WUFDL0QscUJBQXFCLENBQUMsaUJBQWlCLENBQUMsZUFBZSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtTQUM1RTtRQUNELFNBQVMsRUFBRSxxQkFBcUI7UUFDaEMsVUFBVSxFQUFFLEdBQUc7S0FDaEIsQ0FBQztJQUVGLE9BQU8sUUFBUSxDQUFDO0FBQ2xCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFdmVudEJyaWRnZUV2ZW50LCBDb250ZXh0LCBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBVcGRhdGVDb21tYW5kLCBHZXRDb21tYW5kLCBTY2FuQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyBTM0NsaWVudCwgR2V0T2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZSc7XG5cbmNvbnN0IGR5bmFtb2RiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGR5bmFtb2RiID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb2RiQ2xpZW50KTtcbmNvbnN0IHMzID0gbmV3IFMzQ2xpZW50KHt9KTtcbmNvbnN0IGJlZHJvY2sgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbmNvbnN0IERBVEFfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRBVEFfVEFCTEVfTkFNRSE7XG5jb25zdCBEQVRBX0JVQ0tFVF9OQU1FID0gcHJvY2Vzcy5lbnYuREFUQV9CVUNLRVRfTkFNRSE7XG5cbmludGVyZmFjZSBEYXRhUHJvY2Vzc2VkRXZlbnQge1xuICB0ZW5hbnRJZDogc3RyaW5nO1xuICBkYXRhSWQ6IHN0cmluZztcbiAgczNLZXk6IHN0cmluZztcbiAgdGltZXN0YW1wOiBzdHJpbmc7XG4gIHByb2Nlc3NlZEF0OiBzdHJpbmc7XG4gIHByb2Nlc3NpbmdSZXN1bHRzOiB7XG4gICAgcmVjb3JkQ291bnQ/OiBudW1iZXI7XG4gICAgZGF0YVNpemU/OiBudW1iZXI7XG4gICAgdmFsaWRhdGlvblN0YXR1czogc3RyaW5nO1xuICAgIGV4dHJhY3RlZEZpZWxkcz86IHN0cmluZ1tdO1xuICAgIHF1YWxpdHlTY29yZT86IG51bWJlcjtcbiAgICBba2V5OiBzdHJpbmddOiBhbnk7XG4gIH07XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuaW50ZXJmYWNlIEFJSW5zaWdodHMge1xuICBzdW1tYXJ5OiBzdHJpbmc7XG4gIGtleUluc2lnaHRzOiBzdHJpbmdbXTtcbiAgcmVjb21tZW5kYXRpb25zOiBzdHJpbmdbXTtcbiAgcmlza0ZhY3RvcnM6IHN0cmluZ1tdO1xuICBvcHBvcnR1bml0aWVzOiBzdHJpbmdbXTtcbiAgZGF0YVF1YWxpdHlOb3Rlczogc3RyaW5nW107XG4gIG1vZGVsVXNlZDogc3RyaW5nO1xuICBjb25maWRlbmNlOiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogRXZlbnRCcmlkZ2VFdmVudDwnRGF0YVByb2Nlc3NlZCcsIERhdGFQcm9jZXNzZWRFdmVudD4gfCBBUElHYXRld2F5UHJveHlFdmVudCxcbiAgY29udGV4dDogQ29udGV4dFxuKTogUHJvbWlzZTx2b2lkIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gIHRyeSB7XG4gICAgY29uc29sZS5sb2coJ0luc2lnaHRzIGZ1bmN0aW9uIHRyaWdnZXJlZDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhbiBBUEkgR2F0ZXdheSByZXF1ZXN0XG4gICAgaWYgKCdodHRwTWV0aG9kJyBpbiBldmVudCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUFwaUdhdGV3YXlSZXF1ZXN0KGV2ZW50KTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgRXZlbnRCcmlkZ2UgZXZlbnRcbiAgICByZXR1cm4gYXdhaXQgaGFuZGxlRXZlbnRCcmlkZ2VFdmVudChldmVudCBhcyBFdmVudEJyaWRnZUV2ZW50PCdEYXRhUHJvY2Vzc2VkJywgRGF0YVByb2Nlc3NlZEV2ZW50Pik7XG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBpbnNpZ2h0cyBmdW5jdGlvbjonLCBlcnJvcik7XG4gICAgXG4gICAgLy8gSWYgaXQncyBhbiBBUEkgR2F0ZXdheSByZXF1ZXN0LCByZXR1cm4gZXJyb3IgcmVzcG9uc2VcbiAgICBpZiAoJ2h0dHBNZXRob2QnIGluIGV2ZW50KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1UZW5hbnQtSUQnLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxPUFRJT05TJyxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJyxcbiAgICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJyxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBGb3IgRXZlbnRCcmlkZ2UgZXZlbnRzLCB1cGRhdGUgZXJyb3Igc3RhdHVzXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgdGVuYW50SWQsIGRhdGFJZCB9ID0gKGV2ZW50IGFzIEV2ZW50QnJpZGdlRXZlbnQ8J0RhdGFQcm9jZXNzZWQnLCBEYXRhUHJvY2Vzc2VkRXZlbnQ+KS5kZXRhaWw7XG4gICAgICBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiBEQVRBX1RBQkxFX05BTUUsXG4gICAgICAgIEtleToge1xuICAgICAgICAgIHRlbmFudElkLFxuICAgICAgICAgIGRhdGFJZCxcbiAgICAgICAgfSxcbiAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCBpbnNpZ2h0c0Vycm9yID0gOmVycm9yLCBpbnNpZ2h0c0dlbmVyYXRlZEF0ID0gOnRpbWVzdGFtcCcsXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAnOmVycm9yJzogKGVycm9yIGFzIEVycm9yKS5tZXNzYWdlLFxuICAgICAgICAgICc6dGltZXN0YW1wJzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB9LFxuICAgICAgfSkpO1xuICAgIH0gY2F0Y2ggKHVwZGF0ZUVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gdXBkYXRlIGluc2lnaHRzIGVycm9yIHN0YXR1czonLCB1cGRhdGVFcnJvcik7XG4gICAgfVxuICAgIFxuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuXG4vLyBSYXRlIGxpbWl0aW5nIHN0b3JlIChpbi1tZW1vcnksIHJlc2V0cyBvbiBjb2xkIHN0YXJ0KVxuY29uc3QgcmF0ZUxpbWl0U3RvcmUgPSBuZXcgTWFwPHN0cmluZywgeyBjb3VudDogbnVtYmVyOyByZXNldFRpbWU6IG51bWJlciB9PigpO1xuY29uc3QgUkFURV9MSU1JVF9NQVhfQ0FMTFMgPSA2O1xuY29uc3QgUkFURV9MSU1JVF9XSU5ET1dfTVMgPSA2MDAwMDsgLy8gMSBtaW51dGVcblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQXBpR2F0ZXdheVJlcXVlc3QoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgdHJ5IHtcbiAgICAvLyBFeHRyYWN0IHBhcmFtZXRlcnMgZnJvbSB0aGUgcmVxdWVzdFxuICAgIGNvbnN0IGRhdGFJZCA9IGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycz8uZGF0YUlkO1xuICAgIGNvbnN0IHByb21wdCA9IGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycz8ucHJvbXB0O1xuICAgIFxuICAgIGlmICghZGF0YUlkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1UZW5hbnQtSUQnLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxPUFRJT05TJyxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXI6IGRhdGFJZCcsXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBwcm9tcHQgbGVuZ3RoXG4gICAgaWYgKHByb21wdCAmJiBwcm9tcHQubGVuZ3RoID4gMTAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1UZW5hbnQtSUQnLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxPUFRJT05TJyxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGVycm9yOiAnUHJvbXB0IGlzIHRvbyBsb25nLiBNYXhpbXVtIGxlbmd0aCBpcyAxMDAgY2hhcmFjdGVycy4nLFxuICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gR2V0IHVzZXIgY29udGV4dCBmb3IgcmF0ZSBsaW1pdGluZ1xuICAgIGNvbnN0IHVzZXJDb250ZXh0ID0gZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplcj8uY2xhaW1zO1xuICAgIGNvbnN0IHVzZXJJZCA9IHVzZXJDb250ZXh0Py5zdWIgfHwgdXNlckNvbnRleHQ/LlsnY29nbml0bzp1c2VybmFtZSddIHx8ICd1bmtub3duJztcbiAgICBjb25zb2xlLmxvZygnVXNlciBjb250ZXh0OicsIEpTT04uc3RyaW5naWZ5KHVzZXJDb250ZXh0LCBudWxsLCAyKSk7XG4gICAgY29uc29sZS5sb2coJ1JhdGUgbGltaXRpbmcgZm9yIHVzZXI6JywgdXNlcklkKTtcbiAgICBcbiAgICAvLyBDaGVjayByYXRlIGxpbWl0XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB1c2VyUmF0ZUxpbWl0ID0gcmF0ZUxpbWl0U3RvcmUuZ2V0KHVzZXJJZCk7XG4gICAgXG4gICAgaWYgKHVzZXJSYXRlTGltaXQpIHtcbiAgICAgIGlmIChub3cgPCB1c2VyUmF0ZUxpbWl0LnJlc2V0VGltZSkge1xuICAgICAgICAvLyBXaXRoaW4gdGhlIHRpbWUgd2luZG93XG4gICAgICAgIGlmICh1c2VyUmF0ZUxpbWl0LmNvdW50ID49IFJBVEVfTElNSVRfTUFYX0NBTExTKSB7XG4gICAgICAgICAgY29uc3Qgc2Vjb25kc1VudGlsUmVzZXQgPSBNYXRoLmNlaWwoKHVzZXJSYXRlTGltaXQucmVzZXRUaW1lIC0gbm93KSAvIDEwMDApO1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBSYXRlIGxpbWl0IGV4Y2VlZGVkIGZvciB1c2VyICR7dXNlcklkfS4gUmV0cnkgYWZ0ZXIgJHtzZWNvbmRzVW50aWxSZXNldH0gc2Vjb25kcy5gKTtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDI5LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCcsXG4gICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxPUFRJT05TJyxcbiAgICAgICAgICAgICAgJ1JldHJ5LUFmdGVyJzogc2Vjb25kc1VudGlsUmVzZXQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIGVycm9yOiAnUmF0ZSBsaW1pdCBleGNlZWRlZCcsXG4gICAgICAgICAgICAgIG1lc3NhZ2U6IGBZb3UgaGF2ZSBleGNlZWRlZCB0aGUgcmF0ZSBsaW1pdCBvZiAke1JBVEVfTElNSVRfTUFYX0NBTExTfSByZXF1ZXN0cyBwZXIgbWludXRlLiBQbGVhc2UgdHJ5IGFnYWluIGluICR7c2Vjb25kc1VudGlsUmVzZXR9IHNlY29uZHMuYCxcbiAgICAgICAgICAgICAgcmV0cnlBZnRlcjogc2Vjb25kc1VudGlsUmVzZXQsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIEluY3JlbWVudCBjb3VudFxuICAgICAgICB1c2VyUmF0ZUxpbWl0LmNvdW50Kys7XG4gICAgICAgIGNvbnNvbGUubG9nKGBSYXRlIGxpbWl0IGNvdW50IGZvciB1c2VyICR7dXNlcklkfTogJHt1c2VyUmF0ZUxpbWl0LmNvdW50fS8ke1JBVEVfTElNSVRfTUFYX0NBTExTfWApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGltZSB3aW5kb3cgZXhwaXJlZCwgcmVzZXRcbiAgICAgICAgcmF0ZUxpbWl0U3RvcmUuc2V0KHVzZXJJZCwgeyBjb3VudDogMSwgcmVzZXRUaW1lOiBub3cgKyBSQVRFX0xJTUlUX1dJTkRPV19NUyB9KTtcbiAgICAgICAgY29uc29sZS5sb2coYFJhdGUgbGltaXQgcmVzZXQgZm9yIHVzZXIgJHt1c2VySWR9YCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZpcnN0IHJlcXVlc3QgZnJvbSB0aGlzIHVzZXJcbiAgICAgIHJhdGVMaW1pdFN0b3JlLnNldCh1c2VySWQsIHsgY291bnQ6IDEsIHJlc2V0VGltZTogbm93ICsgUkFURV9MSU1JVF9XSU5ET1dfTVMgfSk7XG4gICAgICBjb25zb2xlLmxvZyhgRmlyc3QgcmVxdWVzdCBmcm9tIHVzZXIgJHt1c2VySWR9YCk7XG4gICAgfVxuICAgIFxuICAgIC8vIFNpbmNlIHdlIGRvbid0IGhhdmUgdGVuYW50IElEIGluIHVzZXIgY2xhaW1zLCB3ZSBuZWVkIHRvIHNjYW4gRHluYW1vREIgdG8gZmluZCB0aGUgZmlsZVxuICAgIC8vIEluIGEgcHJvZHVjdGlvbiBlbnZpcm9ubWVudCwgeW91J2Qgd2FudCB0byBhZGQgYSBHU0kgb24gZGF0YUlkIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICBjb25zdCB7IEl0ZW1zIH0gPSBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERBVEFfVEFCTEVfTkFNRSxcbiAgICAgIEZpbHRlckV4cHJlc3Npb246ICdkYXRhSWQgPSA6ZGF0YUlkJyxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgJzpkYXRhSWQnOiBkYXRhSWQsXG4gICAgICB9LFxuICAgICAgTGltaXQ6IDEsXG4gICAgfSkpO1xuXG4gICAgaWYgKCFJdGVtcyB8fCBJdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCcsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULE9QVElPTlMnLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgZXJyb3I6ICdGaWxlIG5vdCBmb3VuZCcsXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlUmVjb3JkID0gSXRlbXNbMF07XG4gICAgY29uc3QgdGVuYW50SWQgPSBmaWxlUmVjb3JkLnRlbmFudElkO1xuXG4gICAgLy8gUmV0cmlldmUgdGhlIHByb2Nlc3NlZCBkYXRhIGZyb20gUzNcbiAgICBjb25zdCBzM0tleSA9IGZpbGVSZWNvcmQuczNLZXk7XG4gICAgaWYgKCFzM0tleSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtVGVuYW50LUlEJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsT1BUSU9OUycsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBlcnJvcjogJ05vIFMzIGtleSBmb3VuZCBmb3IgdGhpcyBmaWxlJyxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHMzT2JqZWN0ID0gYXdhaXQgczMuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICBCdWNrZXQ6IERBVEFfQlVDS0VUX05BTUUsXG4gICAgICBLZXk6IHMzS2V5LFxuICAgIH0pKTtcblxuICAgIGlmICghczNPYmplY3QuQm9keSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtVGVuYW50LUlEJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsT1BUSU9OUycsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBlcnJvcjogJ0RhdGEgbm90IGZvdW5kIGluIFMzJyxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGF3YWl0IHMzT2JqZWN0LkJvZHkudHJhbnNmb3JtVG9TdHJpbmcoKSk7XG4gICAgY29uc3QgcHJvY2Vzc2luZ1Jlc3VsdHMgPSBmaWxlUmVjb3JkLnByb2Nlc3NpbmdSZXN1bHRzIHx8IHt9O1xuICAgIFxuICAgIC8vIEdlbmVyYXRlIGFkZGl0aW9uYWwgaW5zaWdodHMgYmFzZWQgb24gdGhlIHByb21wdFxuICAgIGNvbnN0IGluc2lnaHRzID0gYXdhaXQgZ2VuZXJhdGVBZGRpdGlvbmFsSW5zaWdodHMoZGF0YSwgcHJvY2Vzc2luZ1Jlc3VsdHMsIHByb21wdCk7XG4gICAgXG4gICAgLy8gU2F2ZSB0aGUgaW5zaWdodCB0byBEeW5hbW9EQiAoYXBwZW5kIHRvIGluc2lnaHRzIGhpc3RvcnkpXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGluc2lnaHRSZWNvcmQgPSB7XG4gICAgICB0aW1lc3RhbXAsXG4gICAgICB1c2VySWQsXG4gICAgICBwcm9tcHQ6IHByb21wdCB8fCAnR2VuZXJhbCBpbnNpZ2h0cycsXG4gICAgICByZXNwb25zZTogaW5zaWdodHMsXG4gICAgfTtcblxuICAgIC8vIEdldCBleGlzdGluZyBpbnNpZ2h0cyBhcnJheSBvciBpbml0aWFsaXplIGVtcHR5IGFycmF5XG4gICAgY29uc3QgZXhpc3RpbmdJbnNpZ2h0cyA9IGZpbGVSZWNvcmQuaW5zaWdodHMgfHwgW107XG4gICAgXG4gICAgLy8gS2VlcCBvbmx5IHRoZSBsYXN0IDEwIGluc2lnaHRzIChjb25maWd1cmFibGUpXG4gICAgY29uc3QgTUFYX0lOU0lHSFRTID0gMTA7XG4gICAgY29uc3QgdXBkYXRlZEluc2lnaHRzID0gWy4uLmV4aXN0aW5nSW5zaWdodHMsIGluc2lnaHRSZWNvcmRdLnNsaWNlKC1NQVhfSU5TSUdIVFMpO1xuXG4gICAgLy8gVXBkYXRlIER5bmFtb0RCIHdpdGggbmV3IGluc2lnaHRcbiAgICBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogREFUQV9UQUJMRV9OQU1FLFxuICAgICAgS2V5OiB7XG4gICAgICAgIHRlbmFudElkLFxuICAgICAgICBkYXRhSWQsXG4gICAgICB9LFxuICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCBpbnNpZ2h0cyA9IDppbnNpZ2h0cywgbGFzdEluc2lnaHRBdCA9IDp0aW1lc3RhbXAnLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAnOmluc2lnaHRzJzogdXBkYXRlZEluc2lnaHRzLFxuICAgICAgICAnOnRpbWVzdGFtcCc6IHRpbWVzdGFtcCxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgY29uc29sZS5sb2coYEluc2lnaHQgc2F2ZWQgZm9yIGRhdGFJZDogJHtkYXRhSWR9LCB1c2VySWQ6ICR7dXNlcklkfWApO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtVGVuYW50LUlEJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULE9QVElPTlMnLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgaW5zaWdodHMsXG4gICAgICAgIGRhdGFJZCxcbiAgICAgICAgdGVuYW50SWQsXG4gICAgICAgIHByb21wdCxcbiAgICAgICAgc2F2ZWQ6IHRydWUsXG4gICAgICAgIGluc2lnaHRIaXN0b3J5OiB1cGRhdGVkSW5zaWdodHMsXG4gICAgICB9KSxcbiAgICB9O1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaGFuZGxpbmcgQVBJIEdhdGV3YXkgcmVxdWVzdDonLCBlcnJvcik7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1UZW5hbnQtSUQnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsT1BUSU9OUycsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnLFxuICAgICAgfSksXG4gICAgfTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVFdmVudEJyaWRnZUV2ZW50KGV2ZW50OiBFdmVudEJyaWRnZUV2ZW50PCdEYXRhUHJvY2Vzc2VkJywgRGF0YVByb2Nlc3NlZEV2ZW50Pik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IFxuICAgIHRlbmFudElkLCBcbiAgICBkYXRhSWQsIFxuICAgIHMzS2V5LCBcbiAgICBwcm9jZXNzaW5nUmVzdWx0cywgXG4gICAgbWV0YWRhdGEgXG4gIH0gPSBldmVudC5kZXRhaWw7XG5cbiAgLy8gUmV0cmlldmUgcHJvY2Vzc2VkIGRhdGEgZnJvbSBTM1xuICBjb25zdCBzM09iamVjdCA9IGF3YWl0IHMzLnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgIEJ1Y2tldDogREFUQV9CVUNLRVRfTkFNRSxcbiAgICBLZXk6IHMzS2V5LFxuICB9KSk7XG5cbiAgaWYgKCFzM09iamVjdC5Cb2R5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdObyBkYXRhIGZvdW5kIGluIFMzIG9iamVjdCcpO1xuICB9XG5cbiAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgczNPYmplY3QuQm9keS50cmFuc2Zvcm1Ub1N0cmluZygpKTtcbiAgXG4gIC8vIEdlbmVyYXRlIEFJIGluc2lnaHRzIHVzaW5nIEJlZHJvY2tcbiAgY29uc3QgaW5zaWdodHMgPSBhd2FpdCBnZW5lcmF0ZUFJSW5zaWdodHMoZGF0YSwgcHJvY2Vzc2luZ1Jlc3VsdHMsIG1ldGFkYXRhKTtcbiAgXG4gIC8vIFN0b3JlIGluc2lnaHRzIGluIER5bmFtb0RCXG4gIGF3YWl0IGR5bmFtb2RiLnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogREFUQV9UQUJMRV9OQU1FLFxuICAgIEtleToge1xuICAgICAgdGVuYW50SWQsXG4gICAgICBkYXRhSWQsXG4gICAgfSxcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUIGFpSW5zaWdodHMgPSA6aW5zaWdodHMsIGluc2lnaHRzR2VuZXJhdGVkQXQgPSA6dGltZXN0YW1wLCAjc3RhdHVzID0gOnN0YXR1cycsXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxuICAgIH0sXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgJzppbnNpZ2h0cyc6IGluc2lnaHRzLFxuICAgICAgJzp0aW1lc3RhbXAnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAnOnN0YXR1cyc6ICdJTlNJR0hUU19HRU5FUkFURUQnLFxuICAgIH0sXG4gIH0pKTtcblxuICBjb25zb2xlLmxvZyhgQUkgaW5zaWdodHMgZ2VuZXJhdGVkIHN1Y2Nlc3NmdWxseTogJHtkYXRhSWR9IGZvciB0ZW5hbnQ6ICR7dGVuYW50SWR9YCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlQWRkaXRpb25hbEluc2lnaHRzKFxuICBkYXRhOiBhbnksXG4gIHByb2Nlc3NpbmdSZXN1bHRzOiBhbnksXG4gIHByb21wdD86IHN0cmluZ1xuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgdHJ5IHtcbiAgICAvLyBDcmVhdGUgYSBjdXN0b20gcHJvbXB0IGJhc2VkIG9uIHVzZXIgaW5wdXRcbiAgICBjb25zdCBjdXN0b21Qcm9tcHQgPSBwcm9tcHQgXG4gICAgICA/IGBCYXNlZCBvbiB0aGUgZm9sbG93aW5nIGRhdGEsIHBsZWFzZSBhbnN3ZXIgdGhpcyBzcGVjaWZpYyBxdWVzdGlvbjogXCIke3Byb21wdH1cIlxcblxcbkRhdGEgY29udGV4dDpcXG4ke0pTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICByZWNvcmRDb3VudDogcHJvY2Vzc2luZ1Jlc3VsdHMucmVjb3JkQ291bnQgfHwgMCxcbiAgICAgICAgICBkYXRhU2l6ZTogcHJvY2Vzc2luZ1Jlc3VsdHMuZGF0YVNpemUgfHwgMCxcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IHByb2Nlc3NpbmdSZXN1bHRzLnF1YWxpdHlTY29yZSB8fCAwLFxuICAgICAgICAgIGV4dHJhY3RlZEZpZWxkczogcHJvY2Vzc2luZ1Jlc3VsdHMuZXh0cmFjdGVkRmllbGRzIHx8IFtdLFxuICAgICAgICAgIHNhbXBsZURhdGE6IEFycmF5LmlzQXJyYXkoZGF0YSkgPyBkYXRhLnNsaWNlKDAsIDUpIDogZGF0YSxcbiAgICAgICAgfSwgbnVsbCwgMil9XFxuXFxuUGxlYXNlIHByb3ZpZGUgYSBkZXRhaWxlZCwgYWN0aW9uYWJsZSByZXNwb25zZSB0byB0aGUgcXVlc3Rpb24uYFxuICAgICAgOiBgUGxlYXNlIGFuYWx5emUgdGhlIGZvbGxvd2luZyBkYXRhIGFuZCBwcm92aWRlIGtleSBpbnNpZ2h0czpcXG5cXG4ke0pTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICByZWNvcmRDb3VudDogcHJvY2Vzc2luZ1Jlc3VsdHMucmVjb3JkQ291bnQgfHwgMCxcbiAgICAgICAgICBkYXRhU2l6ZTogcHJvY2Vzc2luZ1Jlc3VsdHMuZGF0YVNpemUgfHwgMCxcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IHByb2Nlc3NpbmdSZXN1bHRzLnF1YWxpdHlTY29yZSB8fCAwLFxuICAgICAgICAgIGV4dHJhY3RlZEZpZWxkczogcHJvY2Vzc2luZ1Jlc3VsdHMuZXh0cmFjdGVkRmllbGRzIHx8IFtdLFxuICAgICAgICAgIHNhbXBsZURhdGE6IEFycmF5LmlzQXJyYXkoZGF0YSkgPyBkYXRhLnNsaWNlKDAsIDUpIDogZGF0YSxcbiAgICAgICAgfSwgbnVsbCwgMil9YDtcblxuICAgIC8vIFVzZSBCZWRyb2NrIHRvIGdlbmVyYXRlIGluc2lnaHRzXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrLnNlbmQobmV3IEludm9rZU1vZGVsQ29tbWFuZCh7XG4gICAgICBtb2RlbElkOiAnYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJyxcbiAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgYW50aHJvcGljX3ZlcnNpb246ICdiZWRyb2NrLTIwMjMtMDUtMzEnLFxuICAgICAgICBtYXhfdG9rZW5zOiAyMDAwLFxuICAgICAgICB0ZW1wZXJhdHVyZTogMC4zLFxuICAgICAgICBzeXN0ZW06IGBZb3UgYXJlIGFuIGV4cGVydCBkYXRhIGFuYWx5c3QuIFByb3ZpZGUgY2xlYXIsIGFjdGlvbmFibGUgaW5zaWdodHMgYmFzZWQgb24gdGhlIGRhdGEgcHJvdmlkZWQuIEJlIHNwZWNpZmljIGFuZCBwcmFjdGljYWwgaW4geW91ciBhbmFseXNpcy5gLFxuICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IGN1c3RvbVByb21wdCxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgfSkpO1xuXG4gICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSEpKTtcbiAgICByZXR1cm4gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dDtcbiAgICBcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdCZWRyb2NrIEFQSSBjYWxsIGZhaWxlZDonLCBlcnJvcik7XG4gICAgXG4gICAgLy8gRmFsbGJhY2sgcmVzcG9uc2VcbiAgICByZXR1cm4gYEFuYWx5c2lzIGNvbXBsZXRlZCB3aXRoIGZhbGxiYWNrIG1ldGhvZC4gJHtwcm9tcHQgPyBgUXVlc3Rpb246ICR7cHJvbXB0fWAgOiAnR2VuZXJhbCBhbmFseXNpcyd9IC0gRGF0YSBjb250YWlucyAke3Byb2Nlc3NpbmdSZXN1bHRzLnJlY29yZENvdW50IHx8IDB9IHJlY29yZHMgd2l0aCBxdWFsaXR5IHNjb3JlIG9mICR7cHJvY2Vzc2luZ1Jlc3VsdHMucXVhbGl0eVNjb3JlIHx8ICdVbmtub3duJ30uIENvbnNpZGVyIHJldmlld2luZyB0aGUgZGF0YSBmb3IgYnVzaW5lc3Mgb3Bwb3J0dW5pdGllcyBhbmQgcG90ZW50aWFsIGltcHJvdmVtZW50cy5gO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlQUlJbnNpZ2h0cyhcbiAgZGF0YTogYW55LCBcbiAgcHJvY2Vzc2luZ1Jlc3VsdHM6IGFueSwgXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55PlxuKTogUHJvbWlzZTxBSUluc2lnaHRzPiB7XG4gIFxuICAvLyBQcmVwYXJlIGNvbnRleHQgZm9yIEFJIG1vZGVsXG4gIGNvbnN0IGNvbnRleHQgPSBidWlsZEFuYWx5c2lzQ29udGV4dChkYXRhLCBwcm9jZXNzaW5nUmVzdWx0cywgbWV0YWRhdGEpO1xuICBcbiAgLy8gQ3JlYXRlIHByb21wdCBmb3IgQmVkcm9ja1xuICBjb25zdCBwcm9tcHQgPSBjcmVhdGVBbmFseXNpc1Byb21wdChjb250ZXh0KTtcbiAgXG4gIHRyeSB7XG4gICAgLy8gVXNlIENsYXVkZSAzIFNvbm5ldCBmb3IgYW5hbHlzaXMgKHlvdSBjYW4gY2hhbmdlIHRoaXMgdG8gb3RoZXIgbW9kZWxzKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9jay5zZW5kKG5ldyBJbnZva2VNb2RlbENvbW1hbmQoe1xuICAgICAgbW9kZWxJZDogJ2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtMjAyNDAyMjktdjE6MCcsXG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiAnYmVkcm9jay0yMDIzLTA1LTMxJyxcbiAgICAgICAgbWF4X3Rva2VuczogNDAwMCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuMyxcbiAgICAgICAgc3lzdGVtOiBgWW91IGFyZSBhbiBleHBlcnQgZGF0YSBhbmFseXN0IGFuZCBidXNpbmVzcyBpbnRlbGxpZ2VuY2Ugc3BlY2lhbGlzdC4gXG4gICAgICAgIEFuYWx5emUgdGhlIHByb3ZpZGVkIGRhdGEgYW5kIGdlbmVyYXRlIGFjdGlvbmFibGUgaW5zaWdodHMsIHJlY29tbWVuZGF0aW9ucywgYW5kIHJpc2sgYXNzZXNzbWVudHMuIFxuICAgICAgICBCZSBzcGVjaWZpYywgcHJhY3RpY2FsLCBhbmQgYnVzaW5lc3MtZm9jdXNlZCBpbiB5b3VyIGFuYWx5c2lzLmAsXG4gICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICAgICAgY29udGVudDogcHJvbXB0LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5ISkpO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0O1xuICAgIFxuICAgIC8vIFBhcnNlIHRoZSBBSSByZXNwb25zZSBhbmQgc3RydWN0dXJlIGl0XG4gICAgcmV0dXJuIHBhcnNlQUlSZXNwb25zZShjb250ZW50KTtcbiAgICBcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdCZWRyb2NrIEFQSSBjYWxsIGZhaWxlZDonLCBlcnJvcik7XG4gICAgXG4gICAgLy8gRmFsbGJhY2sgdG8gcnVsZS1iYXNlZCBpbnNpZ2h0cyBpZiBBSSBmYWlsc1xuICAgIHJldHVybiBnZW5lcmF0ZUZhbGxiYWNrSW5zaWdodHMoZGF0YSwgcHJvY2Vzc2luZ1Jlc3VsdHMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQW5hbHlzaXNDb250ZXh0KFxuICBkYXRhOiBhbnksIFxuICBwcm9jZXNzaW5nUmVzdWx0czogYW55LCBcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4pOiBzdHJpbmcge1xuICBjb25zdCBjb250ZXh0ID0ge1xuICAgIHJlY29yZENvdW50OiBwcm9jZXNzaW5nUmVzdWx0cy5yZWNvcmRDb3VudCB8fCAwLFxuICAgIGRhdGFTaXplOiBwcm9jZXNzaW5nUmVzdWx0cy5kYXRhU2l6ZSB8fCAwLFxuICAgIHF1YWxpdHlTY29yZTogcHJvY2Vzc2luZ1Jlc3VsdHMucXVhbGl0eVNjb3JlIHx8IDAsXG4gICAgZXh0cmFjdGVkRmllbGRzOiBwcm9jZXNzaW5nUmVzdWx0cy5leHRyYWN0ZWRGaWVsZHMgfHwgW10sXG4gICAgbWV0YWRhdGE6IG1ldGFkYXRhIHx8IHt9LFxuICAgIHNhbXBsZURhdGE6IEFycmF5LmlzQXJyYXkoZGF0YSkgPyBkYXRhLnNsaWNlKDAsIDMpIDogZGF0YSwgLy8gU2FtcGxlIG9mIGRhdGEgZm9yIGNvbnRleHRcbiAgICBwcm9jZXNzaW5nUmVzdWx0cyxcbiAgfTtcbiAgXG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShjb250ZXh0LCBudWxsLCAyKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQW5hbHlzaXNQcm9tcHQoY29udGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBQbGVhc2UgYW5hbHl6ZSB0aGUgZm9sbG93aW5nIGRhdGEgY29udGV4dCBhbmQgcHJvdmlkZSBjb21wcmVoZW5zaXZlIGJ1c2luZXNzIGluc2lnaHRzOlxuXG4ke2NvbnRleHR9XG5cblBsZWFzZSBwcm92aWRlIHlvdXIgYW5hbHlzaXMgaW4gdGhlIGZvbGxvd2luZyBKU09OIGZvcm1hdDpcbntcbiAgXCJzdW1tYXJ5XCI6IFwiQSBjb25jaXNlIHN1bW1hcnkgb2YgdGhlIGRhdGEgYW5kIGl0cyBidXNpbmVzcyBpbXBsaWNhdGlvbnNcIixcbiAgXCJrZXlJbnNpZ2h0c1wiOiBbXCJLZXkgaW5zaWdodCAxXCIsIFwiS2V5IGluc2lnaHQgMlwiLCBcIktleSBpbnNpZ2h0IDNcIl0sXG4gIFwicmVjb21tZW5kYXRpb25zXCI6IFtcIkFjdGlvbmFibGUgcmVjb21tZW5kYXRpb24gMVwiLCBcIkFjdGlvbmFibGUgcmVjb21tZW5kYXRpb24gMlwiXSxcbiAgXCJyaXNrRmFjdG9yc1wiOiBbXCJQb3RlbnRpYWwgcmlzayAxXCIsIFwiUG90ZW50aWFsIHJpc2sgMlwiXSxcbiAgXCJvcHBvcnR1bml0aWVzXCI6IFtcIkJ1c2luZXNzIG9wcG9ydHVuaXR5IDFcIiwgXCJCdXNpbmVzcyBvcHBvcnR1bml0eSAyXCJdLFxuICBcImRhdGFRdWFsaXR5Tm90ZXNcIjogW1wiRGF0YSBxdWFsaXR5IG9ic2VydmF0aW9uIDFcIiwgXCJEYXRhIHF1YWxpdHkgb2JzZXJ2YXRpb24gMlwiXSxcbiAgXCJtb2RlbFVzZWRcIjogXCJhbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LTIwMjQwMjI5LXYxOjBcIixcbiAgXCJjb25maWRlbmNlXCI6IDAuODVcbn1cblxuRm9jdXMgb24gcHJhY3RpY2FsIGJ1c2luZXNzIHZhbHVlLCBhY3Rpb25hYmxlIGluc2lnaHRzLCBhbmQgc3BlY2lmaWMgcmVjb21tZW5kYXRpb25zIHRoYXQgY291bGQgZHJpdmUgYnVzaW5lc3MgZGVjaXNpb25zLmA7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQUlSZXNwb25zZShjb250ZW50OiBzdHJpbmcpOiBBSUluc2lnaHRzIHtcbiAgdHJ5IHtcbiAgICAvLyBUcnkgdG8gZXh0cmFjdCBKU09OIGZyb20gdGhlIHJlc3BvbnNlXG4gICAgY29uc3QganNvbk1hdGNoID0gY29udGVudC5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgaWYgKGpzb25NYXRjaCkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uTWF0Y2hbMF0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VtbWFyeTogcGFyc2VkLnN1bW1hcnkgfHwgJ0FJIGFuYWx5c2lzIGNvbXBsZXRlZCcsXG4gICAgICAgIGtleUluc2lnaHRzOiBwYXJzZWQua2V5SW5zaWdodHMgfHwgWydBbmFseXNpcyBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5J10sXG4gICAgICAgIHJlY29tbWVuZGF0aW9uczogcGFyc2VkLnJlY29tbWVuZGF0aW9ucyB8fCBbJ1JldmlldyB0aGUgZGF0YSBmb3IgYnVzaW5lc3Mgb3Bwb3J0dW5pdGllcyddLFxuICAgICAgICByaXNrRmFjdG9yczogcGFyc2VkLnJpc2tGYWN0b3JzIHx8IFsnTm8gaW1tZWRpYXRlIHJpc2tzIGlkZW50aWZpZWQnXSxcbiAgICAgICAgb3Bwb3J0dW5pdGllczogcGFyc2VkLm9wcG9ydHVuaXRpZXMgfHwgWydEYXRhIGFuYWx5c2lzIHJldmVhbHMgcG90ZW50aWFsIGZvciBvcHRpbWl6YXRpb24nXSxcbiAgICAgICAgZGF0YVF1YWxpdHlOb3RlczogcGFyc2VkLmRhdGFRdWFsaXR5Tm90ZXMgfHwgWydEYXRhIHF1YWxpdHkgYXNzZXNzbWVudCBjb21wbGV0ZWQnXSxcbiAgICAgICAgbW9kZWxVc2VkOiBwYXJzZWQubW9kZWxVc2VkIHx8ICdhbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LTIwMjQwMjI5LXYxOjAnLFxuICAgICAgICBjb25maWRlbmNlOiBwYXJzZWQuY29uZmlkZW5jZSB8fCAwLjgsXG4gICAgICB9O1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBwYXJzZSBBSSByZXNwb25zZSBhcyBKU09OLCB1c2luZyBmYWxsYmFjayBwYXJzaW5nOicsIGVycm9yKTtcbiAgfVxuICBcbiAgLy8gRmFsbGJhY2sgcGFyc2luZyBpZiBKU09OIGV4dHJhY3Rpb24gZmFpbHNcbiAgcmV0dXJuIHtcbiAgICBzdW1tYXJ5OiBjb250ZW50LnN1YnN0cmluZygwLCAyMDApICsgJy4uLicsXG4gICAga2V5SW5zaWdodHM6IFsnQUkgYW5hbHlzaXMgY29tcGxldGVkJywgJ1JldmlldyB0aGUgZnVsbCByZXNwb25zZSBmb3IgZGV0YWlscyddLFxuICAgIHJlY29tbWVuZGF0aW9uczogWydDb25zaWRlciB0aGUgQUktZ2VuZXJhdGVkIGluc2lnaHRzIGZvciBkZWNpc2lvbiBtYWtpbmcnXSxcbiAgICByaXNrRmFjdG9yczogWydObyBzcGVjaWZpYyByaXNrcyBpZGVudGlmaWVkIGluIHRoZSBhbmFseXNpcyddLFxuICAgIG9wcG9ydHVuaXRpZXM6IFsnRGF0YSBhbmFseXNpcyBwcm92aWRlcyBpbnNpZ2h0cyBmb3IgYnVzaW5lc3Mgb3B0aW1pemF0aW9uJ10sXG4gICAgZGF0YVF1YWxpdHlOb3RlczogWydBSSBhbmFseXNpcyBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5J10sXG4gICAgbW9kZWxVc2VkOiAnYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJyxcbiAgICBjb25maWRlbmNlOiAwLjcsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlRmFsbGJhY2tJbnNpZ2h0cyhcbiAgZGF0YTogYW55LCBcbiAgcHJvY2Vzc2luZ1Jlc3VsdHM6IGFueVxuKTogQUlJbnNpZ2h0cyB7XG4gIGNvbnN0IGluc2lnaHRzOiBBSUluc2lnaHRzID0ge1xuICAgIHN1bW1hcnk6IGBGYWxsYmFjayBhbmFseXNpcyBmb3IgZGF0YSB3aXRoICR7cHJvY2Vzc2luZ1Jlc3VsdHMucmVjb3JkQ291bnQgfHwgMH0gcmVjb3Jkc2AsXG4gICAga2V5SW5zaWdodHM6IFtcbiAgICAgIGBEYXRhIGNvbnRhaW5zICR7cHJvY2Vzc2luZ1Jlc3VsdHMucmVjb3JkQ291bnQgfHwgMH0gcmVjb3Jkc2AsXG4gICAgICBgRGF0YSBxdWFsaXR5IHNjb3JlOiAke3Byb2Nlc3NpbmdSZXN1bHRzLnF1YWxpdHlTY29yZSB8fCAnVW5rbm93bid9YCxcbiAgICAgIGBEYXRhIHNpemU6ICR7KHByb2Nlc3NpbmdSZXN1bHRzLmRhdGFTaXplIHx8IDApIC8gMTAyNH0gS0JgLFxuICAgIF0sXG4gICAgcmVjb21tZW5kYXRpb25zOiBbXG4gICAgICAnUmV2aWV3IGRhdGEgcXVhbGl0eSBhbmQgY29tcGxldGVuZXNzJyxcbiAgICAgICdDb25zaWRlciBpbXBsZW1lbnRpbmcgZGF0YSB2YWxpZGF0aW9uIHJ1bGVzJyxcbiAgICAgICdNb25pdG9yIGRhdGEgcHJvY2Vzc2luZyBwZXJmb3JtYW5jZScsXG4gICAgXSxcbiAgICByaXNrRmFjdG9yczogW1xuICAgICAgJ0ZhbGxiYWNrIGFuYWx5c2lzIHVzZWQgZHVlIHRvIEFJIHNlcnZpY2UgdW5hdmFpbGFiaWxpdHknLFxuICAgICAgJ0xpbWl0ZWQgaW5zaWdodCBkZXB0aCBjb21wYXJlZCB0byBBSSBhbmFseXNpcycsXG4gICAgXSxcbiAgICBvcHBvcnR1bml0aWVzOiBbXG4gICAgICAnSW1wbGVtZW50IGF1dG9tYXRlZCBkYXRhIHF1YWxpdHkgY2hlY2tzJyxcbiAgICAgICdTZXQgdXAgcmVndWxhciBkYXRhIHByb2Nlc3NpbmcgbW9uaXRvcmluZycsXG4gICAgICAnQ29uc2lkZXIgZGF0YSBlbnJpY2htZW50IHN0cmF0ZWdpZXMnLFxuICAgIF0sXG4gICAgZGF0YVF1YWxpdHlOb3RlczogW1xuICAgICAgYFF1YWxpdHkgc2NvcmU6ICR7cHJvY2Vzc2luZ1Jlc3VsdHMucXVhbGl0eVNjb3JlIHx8ICdVbmtub3duJ31gLFxuICAgICAgYEZpZWxkcyBleHRyYWN0ZWQ6ICR7KHByb2Nlc3NpbmdSZXN1bHRzLmV4dHJhY3RlZEZpZWxkcyB8fCBbXSkuam9pbignLCAnKX1gLFxuICAgIF0sXG4gICAgbW9kZWxVc2VkOiAnZmFsbGJhY2stcnVsZS1iYXNlZCcsXG4gICAgY29uZmlkZW5jZTogMC42LFxuICB9O1xuICBcbiAgcmV0dXJuIGluc2lnaHRzO1xufVxuIl19