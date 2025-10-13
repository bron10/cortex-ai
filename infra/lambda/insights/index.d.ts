import { EventBridgeEvent, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
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
export declare const handler: (event: EventBridgeEvent<'DataProcessed', DataProcessedEvent> | APIGatewayProxyEvent, context: Context) => Promise<void | APIGatewayProxyResult>;
export {};
