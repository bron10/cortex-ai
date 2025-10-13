"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
// Initialize AWS SDK v3 clients
const dynamodb = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamodb);
const handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    try {
        // Get all files for the authenticated user (no tenant filtering)
        // The Cognito authorizer ensures only authenticated users can access this endpoint
        const userContext = event.requestContext.authorizer?.claims;
        console.log('User context:', userContext);
        // Scan DynamoDB for all files (in a real multi-tenant app, you'd want to add proper access controls)
        const command = new lib_dynamodb_1.ScanCommand({
            TableName: process.env.DATA_TABLE_NAME,
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
            insights: item.insights || [],
            lastInsightAt: item.lastInsightAt,
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
    }
    catch (error) {
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
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQTRFO0FBRTVFLGdDQUFnQztBQUNoQyxNQUFNLFFBQVEsR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDeEMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBRWpELE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUEyQixFQUFrQyxFQUFFO0lBQzNGLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXRELElBQUk7UUFDRixpRUFBaUU7UUFDakUsbUZBQW1GO1FBQ25GLE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQztRQUM1RCxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUUxQyxxR0FBcUc7UUFDckcsTUFBTSxPQUFPLEdBQUcsSUFBSSwwQkFBVyxDQUFDO1lBQzlCLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWdCO1NBQ3hDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUU3QywyRUFBMkU7UUFDM0UsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDdkIsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxJQUFJLFVBQVU7WUFDakMsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLGlCQUFpQjtZQUN6QyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLElBQUksRUFBRTtZQUM3QixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsWUFBWSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CO1NBQ2pFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsR0FBRyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7UUFFNUYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFO2dCQUNQLGNBQWMsRUFBRSxrQkFBa0I7Z0JBQ2xDLDZCQUE2QixFQUFFLEdBQUc7Z0JBQ2xDLDhCQUE4QixFQUFFLGtGQUFrRjtnQkFDbEgsOEJBQThCLEVBQUUsYUFBYTthQUM5QztZQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixLQUFLO2dCQUNMLEtBQUssRUFBRSxLQUFLLENBQUMsTUFBTTthQUNwQixDQUFDO1NBQ0gsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTdDLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRTtnQkFDUCxjQUFjLEVBQUUsa0JBQWtCO2dCQUNsQyw2QkFBNkIsRUFBRSxHQUFHO2dCQUNsQyw4QkFBOEIsRUFBRSxrRkFBa0Y7Z0JBQ2xILDhCQUE4QixFQUFFLGFBQWE7YUFDOUM7WUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QjthQUMzRSxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQyxDQUFDO0FBL0RXLFFBQUEsT0FBTyxXQStEbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBTY2FuQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5cbi8vIEluaXRpYWxpemUgQVdTIFNESyB2MyBjbGllbnRzXG5jb25zdCBkeW5hbW9kYiA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vZGIpO1xuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICBjb25zb2xlLmxvZygnRXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICB0cnkge1xuICAgIC8vIEdldCBhbGwgZmlsZXMgZm9yIHRoZSBhdXRoZW50aWNhdGVkIHVzZXIgKG5vIHRlbmFudCBmaWx0ZXJpbmcpXG4gICAgLy8gVGhlIENvZ25pdG8gYXV0aG9yaXplciBlbnN1cmVzIG9ubHkgYXV0aGVudGljYXRlZCB1c2VycyBjYW4gYWNjZXNzIHRoaXMgZW5kcG9pbnRcbiAgICBjb25zdCB1c2VyQ29udGV4dCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXI/LmNsYWltcztcbiAgICBjb25zb2xlLmxvZygnVXNlciBjb250ZXh0OicsIHVzZXJDb250ZXh0KTtcbiAgICBcbiAgICAvLyBTY2FuIER5bmFtb0RCIGZvciBhbGwgZmlsZXMgKGluIGEgcmVhbCBtdWx0aS10ZW5hbnQgYXBwLCB5b3UnZCB3YW50IHRvIGFkZCBwcm9wZXIgYWNjZXNzIGNvbnRyb2xzKVxuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgU2NhbkNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5EQVRBX1RBQkxFX05BTUUhLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgICAvLyBUcmFuc2Zvcm0gdGhlIGRhdGEgZm9yIHRoZSBmcm9udGVuZCBhbmQgc29ydCBieSB0aW1lc3RhbXAgKG5ld2VzdCBmaXJzdClcbiAgICBjb25zdCBmaWxlcyA9IHJlc3VsdC5JdGVtcz8ubWFwKGl0ZW0gPT4gKHtcbiAgICAgIGRhdGFJZDogaXRlbS5kYXRhSWQsXG4gICAgICB0ZW5hbnRJZDogaXRlbS50ZW5hbnRJZCxcbiAgICAgIHRpbWVzdGFtcDogaXRlbS50aW1lc3RhbXAsXG4gICAgICBzdGF0dXM6IGl0ZW0uc3RhdHVzIHx8ICdVUExPQURFRCcsXG4gICAgICBmaWxlTmFtZTogaXRlbS5maWxlTmFtZSxcbiAgICAgIGZpbGVTaXplOiBpdGVtLmZpbGVTaXplLFxuICAgICAgdXBsb2FkZWRBdDogaXRlbS51cGxvYWRlZEF0LFxuICAgICAgcHJvY2Vzc2luZ1Jlc3VsdHM6IGl0ZW0ucHJvY2Vzc2luZ1Jlc3VsdHMsXG4gICAgICBhaUluc2lnaHRzOiBpdGVtLmFpSW5zaWdodHMsXG4gICAgICBpbnNpZ2h0czogaXRlbS5pbnNpZ2h0cyB8fCBbXSwgLy8gSW5jbHVkZSBpbnNpZ2h0cyBoaXN0b3J5XG4gICAgICBsYXN0SW5zaWdodEF0OiBpdGVtLmxhc3RJbnNpZ2h0QXQsIC8vIEluY2x1ZGUgbGFzdCBpbnNpZ2h0IHRpbWVzdGFtcFxuICAgICAgaW5zaWdodENvdW50OiAoaXRlbS5pbnNpZ2h0cyB8fCBbXSkubGVuZ3RoLCAvLyBDb3VudCBvZiBpbnNpZ2h0c1xuICAgIH0pKS5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLnRpbWVzdGFtcCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS50aW1lc3RhbXApLmdldFRpbWUoKSkgfHwgW107XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCcsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGZpbGVzLFxuICAgICAgICBjb3VudDogZmlsZXMubGVuZ3RoLFxuICAgICAgfSksXG4gICAgfTtcblxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGxpc3RpbmcgZmlsZXM6JywgZXJyb3IpO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtVGVuYW50LUlEJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULE9QVElPTlMnLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJyxcbiAgICAgIH0pLFxuICAgIH07XG4gIH1cbn07XG4iXX0=