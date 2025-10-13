#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CortexAIStack } from '../lib/cortex-ai-stack';

const app = new cdk.App();

// Get environment from context or use default
const environment = app.node.tryGetContext('environment') || 'dev';
const applicationName = app.node.tryGetContext('applicationName') || 'cortex-ai';
const enableAIInsights = app.node.tryGetContext('enableAIInsights') !== false;

// Get AWS account and region
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

if (!account || !region) {
  throw new Error('CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION environment variables must be set');
}

// Create the main stack
const cortexAIStack = new CortexAIStack(app, `${applicationName}-${environment}-stack`, {
  applicationName,
  environment,
  enableAIInsights,
  env: {
    account,
    region,
  },
  description: `CortexAI Multi-tenant Platform - ${environment} environment`,
  stackName: `${applicationName}-${environment}`,
});

// Add stack tags
cdk.Tags.of(cortexAIStack).add('Application', applicationName);
cdk.Tags.of(cortexAIStack).add('Environment', environment);
cdk.Tags.of(cortexAIStack).add('ManagedBy', 'CDK');
cdk.Tags.of(cortexAIStack).add('Owner', 'CortexAI Team');

// Output the stack name for reference
console.log(`Deploying CortexAI stack: ${cortexAIStack.stackName}`);
console.log(`Environment: ${environment}`);
console.log(`AI Insights enabled: ${enableAIInsights}`);
console.log(`Account: ${account}`);
console.log(`Region: ${region}`);

app.synth();
