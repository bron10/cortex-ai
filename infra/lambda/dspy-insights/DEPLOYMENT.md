# DSPy Lambda Deployment Guide

## Overview

The DSPy Lambda function provides optimized AI insights generation using DSPy (Declarative Self-improving Python). It's integrated as a separate Python Lambda that can be invoked by the TypeScript insights Lambda.

## Architecture

```
┌─────────────────────┐
│  TypeScript Lambda  │
│   (insights/index)  │
└──────────┬──────────┘
           │
           │ (optional invocation)
           │
           ▼
┌─────────────────────┐
│   Python Lambda     │
│ (dspy-insights)     │
└──────────┬──────────┘
           │
           │
           ▼
┌─────────────────────┐
│  Amazon Bedrock     │
│  Claude 3 Sonnet    │
└─────────────────────┘
```

## Deployment Steps

### 1. Install Dependencies Locally (for testing)

```bash
cd infra/lambda/dspy-insights
pip install -r requirements.txt
```

### 2. Deploy with CDK

The DSPy Lambda is automatically included when you deploy the CDK stack:

```bash
cd infra
npm install
cdk deploy
```

The CDK will:
- Bundle Python dependencies automatically
- Create the Lambda function with proper IAM permissions
- Configure environment variables
- Grant the TypeScript insights Lambda permission to invoke it

### 3. Enable/Disable DSPy

Control DSPy usage via environment variable in the TypeScript insights Lambda:

- **Enable DSPy**: Set `USE_DSPY=true` (default)
- **Disable DSPy**: Set `USE_DSPY=false` (falls back to direct Bedrock)

You can update this in the CDK stack (`infra/lib/cortex-ai.ts`) or via AWS Console.

## Testing

### Local Testing

```python
# test_dspy_lambda.py
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

### Testing via API

1. Upload a file via the frontend
2. Generate insights with a prompt
3. Check CloudWatch Logs for DSPy Lambda invocations
4. Compare insights quality between DSPy and direct Bedrock

## Monitoring

### CloudWatch Logs

- **DSPy Lambda**: `/aws/lambda/cortex-ai-{env}-dspy-insights`
- **Insights Lambda**: `/aws/lambda/cortex-ai-{env}-insights`

### Key Metrics

- Invocation count
- Duration (DSPy adds ~50-100ms overhead)
- Error rate
- Bedrock API calls

## Optimization

Run the optimization script periodically to improve prompts:

```bash
cd infra/scripts
python optimize-dspy-prompts.py
```

This will:
1. Load training examples from `dspy-training-examples.json`
2. Optimize prompts using BootstrapFewShot
3. Save optimized prompts to `optimized-dspy-prompts.json`
4. You can then update the Lambda code to use optimized prompts

## Troubleshooting

### Issue: "ModuleNotFoundError: No module named 'dspy'"

**Solution**: Ensure CDK bundling is working correctly. Check that `requirements.txt` is in the Lambda directory.

### Issue: "Bedrock API error"

**Solution**: 
- Verify IAM permissions for Bedrock
- Check that the model ID is correct
- Ensure Bedrock is enabled in your AWS region

### Issue: DSPy Lambda not being invoked

**Solution**:
- Check `USE_DSPY` environment variable
- Verify `DSPY_LAMBDA_NAME` is set correctly
- Check IAM permissions for Lambda invocation

### Issue: High latency

**Solution**:
- DSPy adds ~50-100ms overhead
- Consider increasing Lambda memory (512MB → 1024MB)
- Monitor Bedrock API response times

## Cost Considerations

- **Lambda**: ~$0.20 per 1M requests (512MB, 1s avg)
- **Bedrock**: Same cost as direct calls (DSPy doesn't change API usage)
- **Optimization**: Run in CI/CD (no production cost)

## Next Steps

1. **Collect Training Examples**: Add real examples to `infra/scripts/dspy-training-examples.json`
2. **Run Optimization**: Periodically optimize prompts
3. **A/B Testing**: Compare DSPy vs direct Bedrock insights
4. **Monitor**: Track quality metrics and user feedback
5. **Iterate**: Improve prompts based on results

