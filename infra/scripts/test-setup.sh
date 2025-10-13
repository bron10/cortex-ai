#!/bin/bash

# CortexAI Setup Test Script
# This script verifies that all dependencies and configurations are correct

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo "🧪 CortexAI Setup Test"
echo "======================"

# Test 1: Check Node.js version
print_status "Checking Node.js version..."
NODE_VERSION=$(node --version 2>/dev/null || echo "NOT_FOUND")
if [[ "$NODE_VERSION" == "NOT_FOUND" ]]; then
    print_error "Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_MAJOR -lt 18 ]]; then
    print_error "Node.js version $NODE_VERSION is too old. Please install Node.js 18+"
    exit 1
fi

print_success "Node.js version: $NODE_VERSION ✓"

# Test 2: Check AWS CLI
print_status "Checking AWS CLI..."
if ! command -v aws &> /dev/null; then
    print_warning "AWS CLI is not installed. Please install it for deployment"
else
    AWS_VERSION=$(aws --version)
    print_success "AWS CLI: $AWS_VERSION ✓"
fi

# Test 3: Check AWS CDK
print_status "Checking AWS CDK..."
if ! command -v cdk &> /dev/null; then
    print_warning "AWS CDK CLI is not installed globally. Installing..."
    npm install -g aws-cdk
else
    CDK_VERSION=$(cdk --version)
    print_success "AWS CDK: $CDK_VERSION ✓"
fi

# Test 4: Check project dependencies
print_status "Checking project dependencies..."
if [[ ! -f "package.json" ]]; then
    print_error "package.json not found. Are you in the correct directory?"
    exit 1
fi

print_success "package.json found ✓"

# Test 5: Install dependencies
print_status "Installing project dependencies..."
npm install
print_success "Dependencies installed ✓"

# Test 6: Check Lambda function dependencies
print_status "Checking Lambda function dependencies..."
for lambda_dir in lambda/*/; do
    if [[ -d "$lambda_dir" ]]; then
        lambda_name=$(basename "$lambda_dir")
        print_status "  Checking $lambda_name..."
        
        if [[ -f "$lambda_dir/package.json" ]]; then
            cd "$lambda_dir"
            npm install
            print_success "    $lambda_name dependencies installed ✓"
            cd ../..
        else
            print_warning "    $lambda_name package.json not found"
        fi
    fi
done

# Test 7: Build Lambda functions
print_status "Building Lambda functions..."
for lambda_dir in lambda/*/; do
    if [[ -d "$lambda_dir" ]]; then
        lambda_name=$(basename "$lambda_dir")
        print_status "  Building $lambda_name..."
        
        if [[ -f "$lambda_dir/tsconfig.json" ]]; then
            cd "$lambda_dir"
            npm run build
            print_success "    $lambda_name built successfully ✓"
            cd ../..
        else
            print_warning "    $lambda_name tsconfig.json not found"
        fi
    fi
done

# Test 8: Build CDK project
print_status "Building CDK project..."
npm run build
print_success "CDK project built ✓"

# Test 9: Check AWS credentials
print_status "Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
    print_success "AWS credentials valid ✓"
    print_status "  Account ID: $ACCOUNT_ID"
    print_status "  User ARN: $USER_ARN"
else
    print_warning "AWS credentials not configured or invalid"
    print_status "  Run 'aws configure' to set up credentials"
fi

# Test 10: Check CDK bootstrap
print_status "Checking CDK bootstrap status..."
if cdk list &> /dev/null; then
    print_success "CDK is bootstrapped ✓"
else
    print_warning "CDK is not bootstrapped in this account/region"
    print_status "  Run 'cdk bootstrap' before first deployment"
fi

echo ""
echo "🎉 Setup Test Complete!"
echo "======================"

if [[ -f "package.json" ]]; then
    print_status "Next steps:"
    echo "1. Configure AWS credentials if not done: aws configure"
    echo "2. Bootstrap CDK if needed: cdk bootstrap"
    echo "3. Deploy to development: ./scripts/deploy.sh -e dev"
    echo "4. Check the README.md for detailed instructions"
else
    print_error "Setup test failed. Please check the errors above."
    exit 1
fi

echo ""
print_success "Your CortexAI project is ready to deploy! 🚀"
