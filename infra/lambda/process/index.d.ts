import { EventBridgeEvent, Context } from 'aws-lambda';
interface DataUploadedEvent {
    tenantId: string;
    dataId: string;
    s3Key: string;
    timestamp: string;
    metadata?: Record<string, any>;
}
export declare const handler: (event: EventBridgeEvent<'DataUploaded', DataUploadedEvent>, context: Context) => Promise<void>;
export {};
