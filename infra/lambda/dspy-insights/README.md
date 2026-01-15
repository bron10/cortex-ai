# DSPy Insights Lambda Function

This Lambda function uses DSPy (Declarative Self-improving Python) to generate optimized AI insights from data analysis requests.

## Overview

The DSPy Lambda provides a more sophisticated approach to generating insights by:
- Using modular, declarative programming patterns
- Enabling automated prompt optimization
- Supporting better model abstraction and switching
- Providing structured outputs with type safety

## Architecture

```
TypeScript Insights Lambda → DSPy Lambda (Python) → Amazon Bedrock (Claude 3 Sonnet)
```

The TypeScript insights Lambda can optionally invoke this DSPy Lambda instead of directly calling Bedrock, allowing for A/B testing and gradual migration.

## Setup

### Install Dependencies

```bash
cd infra/lambda/dspy-insights
pip install -r requirements.txt -t .
```

### Local Testing

You can test the Lambda function locally:

```python
import json
from index import lambda_handler

event = {
    "prompt": "What are the top products?",
    "data": [
        {"product": "A", "sales": 100},
        {"product": "B", "sales": 200}
    ],
    "processingResults": {
        "recordCount": 2,
        "qualityScore": 85,
        "extractedFields": ["product", "sales"]
    }
}

result = lambda_handler(event, None)
print(json.dumps(result, indent=2))
```

## Configuration

Environment variables:
- `DATA_TABLE_NAME`: DynamoDB table name for file metadata
- `DATA_BUCKET_NAME`: S3 bucket name for data storage
- `AWS_REGION`: AWS region (default: us-east-1)
- `BEDROCK_MODEL_ID`: Bedrock model ID (default: anthropic.claude-3-sonnet-20240229-v1:0)

## DSPy Signatures

The function defines a `DataInsightSignature` that specifies:
- **Input**: `data_summary` (structured data summary) and `user_question` (user's prompt)
- **Output**: `insights` (detailed, actionable insights)

## Usage

The Lambda can be invoked with:

```json
{
  "prompt": "Generate insights about sales trends",
  "data": [...],
  "processingResults": {
    "recordCount": 1000,
    "qualityScore": 85,
    "extractedFields": ["product", "sales", "date"]
  },
  "dataId": "optional-data-id",
  "tenantId": "optional-tenant-id"
}
```

If `dataId` and `tenantId` are provided, the Lambda will fetch the data from DynamoDB/S3 automatically.

## Optimization

For prompt optimization, see `scripts/optimize-dspy-prompts.py` which can be run in CI/CD or as a scheduled job to improve prompts over time.

## Monitoring

The Lambda logs to CloudWatch with:
- DSPy invocation details
- Bedrock API calls
- Error traces

Check CloudWatch Logs for the function: `cortex-ai-{env}-dspy-insights`

