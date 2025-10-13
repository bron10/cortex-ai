#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CortexAIStack } from '../lib/cortex-ai-stack';

const app = new cdk.App();

// Basic usage example
new CortexAIStack(app, 'BasicCortexAI', {
  environment: 'dev',
  applicationName: 'basic-ai-app',
  enableAIInsights: true,
  description: 'Basic CortexAI implementation for development',
});

// Production configuration example
new CortexAIStack(app, 'ProductionCortexAI', {
  environment: 'prod',
  applicationName: 'enterprise-ai-platform',
  enableAIInsights: true,
  cognitoConfig: {
    userPoolName: 'enterprise-users-prod',
    userPoolClientName: 'enterprise-client-prod',
  },
  dynamoConfig: {
    billingMode: 'PROVISIONED',
    removalPolicy: 'RETAIN',
  },
  s3Config: {
    versioned: true,
    removalPolicy: 'RETAIN',
  },
  description: 'Production CortexAI platform with enterprise features',
});

// Staging configuration without AI insights
new CortexAIStack(app, 'StagingCortexAI', {
  environment: 'staging',
  applicationName: 'staging-ai-app',
  enableAIInsights: false, // Disable AI insights for staging
  description: 'Staging environment without AI insights for cost optimization',
});

app.synth();
