"""
DSPy-powered AI Insights Lambda Function for CortexAI

This Lambda function uses DSPy to generate optimized AI insights
from data analysis requests.
"""

import json
import os
import boto3
from typing import Dict, Any, Optional
import dspy
from dspy.teleprompt import BootstrapFewShot

# Initialize AWS clients
dynamodb_client = boto3.client('dynamodb')
dynamodb_resource = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

# Environment variables
DATA_TABLE_NAME = os.environ.get('DATA_TABLE_NAME')
DATA_BUCKET_NAME = os.environ.get('DATA_BUCKET_NAME')
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')


class BedrockLM(dspy.LM):
    """DSPy Language Model wrapper for Amazon Bedrock"""
    
    def __init__(self, model_id: str = BEDROCK_MODEL_ID):
        super().__init__(model_id)
        self.model_id = model_id
        self.bedrock = bedrock_client
        self.history = []
    
    def __call__(self, prompt: str, **kwargs) -> str:
        """Make a request to Bedrock (DSPy compatibility)"""
        return self.basic_request(prompt, **kwargs)
    
    def basic_request(self, prompt: str, **kwargs) -> str:
        """Make a request to Bedrock"""
        try:
            # Build Bedrock request
            max_tokens = kwargs.get('max_tokens', 2000)
            temperature = kwargs.get('temperature', 0.3)
            system_prompt = kwargs.get('system', 'You are a helpful AI assistant.')
            
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }
            
            response = self.bedrock.invoke_model(
                modelId=self.model_id,
                contentType='application/json',
                accept='application/json',
                body=json.dumps(body)
            )
            
            response_body = json.loads(response['body'].read())
            return response_body['content'][0]['text']
            
        except Exception as e:
            print(f"Bedrock API error: {str(e)}")
            raise


# Define DSPy Signatures
class DataInsightSignature(dspy.Signature):
    """Generate actionable insights from data analysis."""
    data_summary: str = dspy.InputField(
        desc="Summary of data structure, record count, quality score, and sample records"
    )
    user_question: str = dspy.InputField(
        desc="Specific question or prompt about the data"
    )
    insights: str = dspy.OutputField(
        desc="Detailed, actionable insights answering the user's question with specific data points and recommendations"
    )


class DataAnalysisModule(dspy.Module):
    """DSPy module for generating data insights"""
    
    def __init__(self):
        super().__init__()
        self.generate_insights = dspy.ChainOfThought(DataInsightSignature)
    
    def forward(self, data_summary: str, user_question: str) -> str:
        """Generate insights from data summary and user question"""
        result = self.generate_insights(
            data_summary=data_summary,
            user_question=user_question
        )
        return result.insights


def build_data_summary(data: Any, processing_results: Dict[str, Any]) -> str:
    """Build a structured summary of the data for DSPy"""
    summary_parts = []
    
    # Record count
    record_count = processing_results.get('recordCount', 0)
    summary_parts.append(f"Data contains {record_count} records")
    
    # Quality score
    quality_score = processing_results.get('qualityScore', 0)
    summary_parts.append(f"Data quality score: {quality_score}/100")
    
    # Extracted fields
    extracted_fields = processing_results.get('extractedFields', [])
    if extracted_fields:
        summary_parts.append(f"Extracted fields: {', '.join(extracted_fields)}")
    
    # Data size
    data_size = processing_results.get('dataSize', 0)
    if data_size:
        summary_parts.append(f"Data size: {data_size / 1024:.2f} KB")
    
    # Sample data
    if isinstance(data, list) and len(data) > 0:
        summary_parts.append(f"\nSample records (first 3):")
        for i, record in enumerate(data[:3], 1):
            summary_parts.append(f"Record {i}: {json.dumps(record, default=str)}")
    elif isinstance(data, dict):
        summary_parts.append(f"\nData structure: {json.dumps(data, default=str)[:500]}")
    
    return "\n".join(summary_parts)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for DSPy-powered insights generation
    
    Expected event structure:
    {
        "dataSummary": str,  # Optional: pre-built summary
        "data": Any,  # Optional: raw data
        "processingResults": Dict,  # Optional: processing metadata
        "prompt": str,  # User's question/prompt
        "dataId": str,  # Optional: for fetching from S3/DynamoDB
        "tenantId": str  # Optional: for fetching from DynamoDB
    }
    """
    try:
        print(f"DSPy Lambda invoked with event: {json.dumps(event)}")
        
        # Initialize DSPy with Bedrock
        lm = BedrockLM()
        dspy.configure(lm=lm)
        
        # Initialize DSPy module
        analyzer = DataAnalysisModule()
        
        # Extract parameters
        prompt = event.get('prompt', 'Generate general insights about this data')
        data_summary = event.get('dataSummary')
        data = event.get('data')
        processing_results = event.get('processingResults', {})
        data_id = event.get('dataId')
        tenant_id = event.get('tenantId')
        
        # If data summary not provided, build it
        if not data_summary:
            # Try to fetch data if dataId and tenantId provided
            if data_id and tenant_id and DATA_TABLE_NAME:
                try:
                    table = dynamodb_resource.Table(DATA_TABLE_NAME)
                    response = table.get_item(
                        Key={
                            'tenantId': tenant_id,
                            'dataId': data_id
                        }
                    )
                    
                    if 'Item' in response:
                        file_record = response['Item']
                        processing_results = file_record.get('processingResults', {})
                        s3_key = file_record.get('s3Key')
                        
                        # Fetch data from S3 if available
                        if s3_key and DATA_BUCKET_NAME:
                            s3_response = s3_client.get_object(
                                Bucket=DATA_BUCKET_NAME,
                                Key=s3_key
                            )
                            data = json.loads(s3_response['Body'].read().decode('utf-8'))
                
                except Exception as e:
                    print(f"Error fetching data from DynamoDB/S3: {str(e)}")
            
            # Build summary from available data
            if data or processing_results:
                data_summary = build_data_summary(data or {}, processing_results)
            else:
                data_summary = "No data summary available"
        
        # Generate insights using DSPy
        print(f"Generating insights with prompt: {prompt}")
        insights = analyzer(
            data_summary=data_summary,
            user_question=prompt
        )
        
        print(f"Generated insights: {insights[:200]}...")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'insights': insights,
                'model': 'dspy-optimized',
                'modelId': BEDROCK_MODEL_ID,
                'success': True
            })
        }
        
    except Exception as e:
        print(f"Error in DSPy Lambda: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e),
                'success': False
            })
        }

