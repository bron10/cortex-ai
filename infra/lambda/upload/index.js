"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
const dynamodbClient = new client_dynamodb_1.DynamoDBClient({});
const dynamodb = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new client_s3_1.S3Client({});
const eventbridge = new client_eventbridge_1.EventBridgeClient({});
const DATA_TABLE_NAME = process.env.DATA_TABLE_NAME;
const DATA_BUCKET_NAME = process.env.DATA_BUCKET_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENABLE_AI_INSIGHTS = process.env.ENABLE_AI_INSIGHTS === 'true';
const handler = async (event, context) => {
    try {
        console.log('Upload function triggered:', JSON.stringify(event, null, 2));
        // Parse request body first
        let requestBody;
        try {
            requestBody = JSON.parse(event.body || '{}');
        }
        catch (error) {
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
        const dataId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        const s3Key = `${tenantId}/${dataId}.json`;
        // Store data in S3
        await s3.send(new client_s3_1.PutObjectCommand({
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
        await dynamodb.send(new lib_dynamodb_1.PutCommand({
            TableName: DATA_TABLE_NAME,
            Item: metadataItem,
        }));
        // Emit event for processing
        await eventbridge.send(new client_eventbridge_1.PutEventsCommand({
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
        const response = {
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
    }
    catch (error) {
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
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            }),
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQTJFO0FBQzNFLGtEQUFnRTtBQUNoRSxvRUFBa0Y7QUFDbEYsK0JBQW9DO0FBRXBDLE1BQU0sY0FBYyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUM5QyxNQUFNLFFBQVEsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDN0QsTUFBTSxFQUFFLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzVCLE1BQU0sV0FBVyxHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxDQUFDLENBQUM7QUFFOUMsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFnQixDQUFDO0FBQ3JELE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBaUIsQ0FBQztBQUN2RCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUNuRCxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEtBQUssTUFBTSxDQUFDO0FBZTlELE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDZ0IsRUFBRTtJQUNsQyxJQUFJO1FBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUUxRSwyQkFBMkI7UUFDM0IsSUFBSSxXQUEwQixDQUFDO1FBQy9CLElBQUk7WUFDRixXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxDQUFDO1NBQzlDO1FBQUMsT0FBTyxL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QkFBa0I7Z0JBQ2xDLDZCQUE2QixFQUFFLEdBQUc7Z0JBQ2xDLDhCQUE4QixFQUFFLGtGQUFrRjtnQkFDbEgsOEJBQThCLEVBQUUsY0FBYzthQUMvQztZQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixPQUFPLEVBQUUsS0FBSztnQkFDZCxPQUFPLEVBQUUsdUJBQXVCO2dCQUNoQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssYUFBYSxDQUFDLENBQUMsQ0FBRSxLQUFlLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQ3JGLENBQUM7U0FDSCxDQUFDO0tBQ0g7QUFDSCxDQUFDLENBQUM7QUE5SlcsUUFBQSxPQUFPLFdBOEpsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSAndXVpZCc7XG5cbmNvbnN0IGR5bmFtb2RiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGR5bmFtb2RiID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb2RiQ2xpZW50KTtcbmNvbnN0IHMzID0gbmV3IFMzQ2xpZW50KHt9KTtcbmNvbnN0IGV2ZW50YnJpZGdlID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHt9KTtcblxuY29uc3QgREFUQV9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuREFUQV9UQUJMRV9OQU1FITtcbmNvbnN0IERBVEFfQlVDS0VUX05BTUUgPSBwcm9jZXNzLmVudi5EQVRBX0JVQ0tFVF9OQU1FITtcbmNvbnN0IEVWRU5UX0JVU19OQU1FID0gcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhO1xuY29uc3QgRU5BQkxFX0FJX0lOU0lHSFRTID0gcHJvY2Vzcy5lbnYuRU5BQkxFX0FJX0lOU0lHSFRTID09PSAndHJ1ZSc7XG5cbmludGVyZmFjZSBVcGxvYWRSZXF1ZXN0IHtcbiAgdGVuYW50SWQ6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmludGVyZmFjZSBVcGxvYWRSZXNwb25zZSB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIGRhdGFJZDogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG4gIHRlbmFudElkOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXG4gIGNvbnRleHQ6IENvbnRleHRcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gIHRyeSB7XG4gICAgY29uc29sZS5sb2coJ1VwbG9hZCBmdW5jdGlvbiB0cmlnZ2VyZWQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIC8vIFBhcnNlIHJlcXVlc3QgYm9keSBmaXJzdFxuICAgIGxldCByZXF1ZXN0Qm9keTogVXBsb2FkUmVxdWVzdDtcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdEJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1UZW5hbnQtSUQnLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ1BPU1QsT1BUSU9OUycsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScsXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IHRlbmFudCBJRCBmcm9tIHRoZSBhdXRoZW50aWNhdGVkIHVzZXIncyBjb250ZXh0XG4gICAgLy8gVGhlIENvZ25pdG8gYXV0aG9yaXplciBhZGRzIHVzZXIgaW5mb3JtYXRpb24gdG8gdGhlIHJlcXVlc3QgY29udGV4dFxuICAgIGNvbnN0IHVzZXJDb250ZXh0ID0gZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplcj8uY2xhaW1zO1xuICAgIGNvbnN0IHRlbmFudElkID0gdXNlckNvbnRleHQ/LlsnY3VzdG9tOnRlbmFudElkJ10gfHwgXG4gICAgICAgICAgICAgICAgICAgICB1c2VyQ29udGV4dD8uWyd0ZW5hbnRJZCddIHx8XG4gICAgICAgICAgICAgICAgICAgICByZXF1ZXN0Qm9keS50ZW5hbnRJZCB8fCBcbiAgICAgICAgICAgICAgICAgICAgIGV2ZW50LmhlYWRlcnNbJ1gtVGVuYW50LUlEJ107XG4gICAgXG4gICAgaWYgKCF0ZW5hbnRJZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLVRlbmFudC1JRCcsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnUE9TVCxPUFRJT05TJyxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIG1lc3NhZ2U6ICdVc2VyIG11c3QgaGF2ZSB0ZW5hbnRJZCBpbiB0aGVpciBDb2duaXRvIHVzZXIgYXR0cmlidXRlcyBvciBwcm92aWRlIGl0IGluIHJlcXVlc3QgYm9keS9oZWFkZXInLFxuICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxuICAgIGlmICghcmVxdWVzdEJvZHkuZGF0YSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLVRlbmFudC1JRCcsXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnUE9TVCxPUFRJT05TJyxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIG1lc3NhZ2U6ICdkYXRhIGlzIHJlcXVpcmVkJyxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSBkYXRhIElEXG4gICAgY29uc3QgZGF0YUlkID0gdXVpZHY0KCk7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHMzS2V5ID0gYCR7dGVuYW50SWR9LyR7ZGF0YUlkfS5qc29uYDtcblxuICAgIC8vIFN0b3JlIGRhdGEgaW4gUzNcbiAgICBhd2FpdCBzMy5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgIEJ1Y2tldDogREFUQV9CVUNLRVRfTkFNRSxcbiAgICAgIEtleTogczNLZXksXG4gICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0Qm9keS5kYXRhKSxcbiAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICBNZXRhZGF0YToge1xuICAgICAgICB0ZW5hbnRJZCxcbiAgICAgICAgdGltZXN0YW1wLFxuICAgICAgICBkYXRhSWQsXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIC8vIFN0b3JlIG1ldGFkYXRhIGluIER5bmFtb0RCXG4gICAgY29uc3QgbWV0YWRhdGFJdGVtID0ge1xuICAgICAgdGVuYW50SWQsXG4gICAgICBkYXRhSWQsXG4gICAgICBzM0tleSxcbiAgICAgIHRpbWVzdGFtcCxcbiAgICAgIHN0YXR1czogJ1VQTE9BREVEJyxcbiAgICAgIG1ldGFkYXRhOiByZXF1ZXN0Qm9keS5tZXRhZGF0YSB8fCB7fSxcbiAgICAgIHR0bDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAoMzY1ICogMjQgKiA2MCAqIDYwKSwgLy8gMSB5ZWFyIFRUTFxuICAgIH07XG5cbiAgICBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBQdXRDb21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogREFUQV9UQUJMRV9OQU1FLFxuICAgICAgSXRlbTogbWV0YWRhdGFJdGVtLFxuICAgIH0pKTtcblxuICAgIC8vIEVtaXQgZXZlbnQgZm9yIHByb2Nlc3NpbmdcbiAgICBhd2FpdCBldmVudGJyaWRnZS5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICAgIEVudHJpZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIFNvdXJjZTogJ2NvcnRleC1haS51cGxvYWQnLFxuICAgICAgICAgIERldGFpbFR5cGU6ICdEYXRhVXBsb2FkZWQnLFxuICAgICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgdGVuYW50SWQsXG4gICAgICAgICAgICBkYXRhSWQsXG4gICAgICAgICAgICBzM0tleSxcbiAgICAgICAgICAgIHRpbWVzdGFtcCxcbiAgICAgICAgICAgIG1ldGFkYXRhOiByZXF1ZXN0Qm9keS5tZXRhZGF0YSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVU19OQU1FLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICBjb25zb2xlLmxvZyhgRGF0YSB1cGxvYWRlZCBzdWNjZXNzZnVsbHk6ICR7ZGF0YUlkfSBmb3IgdGVuYW50OiAke3RlbmFudElkfWApO1xuXG4gICAgY29uc3QgcmVzcG9uc2U6IFVwbG9hZFJlc3BvbnNlID0ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGRhdGFJZCxcbiAgICAgIG1lc3NhZ2U6ICdEYXRhIHVwbG9hZGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICB0ZW5hbnRJZCxcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1UZW5hbnQtSUQnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdQT1NULE9QVElPTlMnLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgICB9O1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gdXBsb2FkIGZ1bmN0aW9uOicsIGVycm9yKTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCcsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ1BPU1QsT1BUSU9OUycsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgbWVzc2FnZTogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICAgIGVycm9yOiBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JyA/IChlcnJvciBhcyBFcnJvcikubWVzc2FnZSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pLFxuICAgIH07XG4gIH1cbn07XG4iXX0=