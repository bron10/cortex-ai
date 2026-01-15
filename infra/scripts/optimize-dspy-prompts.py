#!/usr/bin/env python3
"""
DSPy Prompt Optimization Script

This script optimizes DSPy prompts using training examples.
Run this periodically (e.g., in CI/CD or as a scheduled job) to improve prompt quality.

Usage:
    python optimize-dspy-prompts.py

Requirements:
    - Training examples in DynamoDB or a JSON file
    - DSPy installed
    - AWS credentials configured
"""

import json
import os
import boto3
from typing import List, Dict, Any
import dspy
from dspy.teleprompt import BootstrapFewShot
from dspy.evaluate import Evaluate

# Import DSPy module from Lambda
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../lambda/dspy-insights'))
from index import BedrockLM, DataAnalysisModule, DataInsightSignature


def load_training_examples(source: str = 'file') -> List[dspy.Example]:
    """
    Load training examples from file or DynamoDB
    
    Example format:
    [
        {
            "data_summary": "Sales data with 1000 records, quality score 85",
            "user_question": "What are the top products?",
            "insights": "Top products: Product A (25%), Product B (20%)..."
        },
        ...
    ]
    """
    examples = []
    
    if source == 'file':
        # Load from JSON file
        examples_file = os.path.join(os.path.dirname(__file__), 'dspy-training-examples.json')
        if os.path.exists(examples_file):
            with open(examples_file, 'r') as f:
                data = json.load(f)
                for item in data:
                    examples.append(dspy.Example(
                        data_summary=item['data_summary'],
                        user_question=item['user_question'],
                        insights=item['insights']
                    ).with_inputs('data_summary', 'user_question'))
        else:
            print(f"Training examples file not found: {examples_file}")
            print("Creating sample file...")
            create_sample_training_file(examples_file)
            return []
    
    elif source == 'dynamodb':
        # Load from DynamoDB (if you store examples there)
        # dynamodb = boto3.resource('dynamodb')
        # table = dynamodb.Table('dspy-training-examples')
        # ... fetch examples ...
        pass
    
    return examples


def create_sample_training_file(filepath: str):
    """Create a sample training examples file"""
    sample_data = [
        {
            "data_summary": "Sales data with 1000 records\nQuality score: 85\nFields: product, sales, date\nSample: [{\"product\": \"A\", \"sales\": 100}]",
            "user_question": "What are the top products?",
            "insights": "Top products by sales: Product A (25% of total sales), Product B (20%), Product C (15%). Product A shows strong performance and should be prioritized for marketing campaigns."
        },
        {
            "data_summary": "Customer data with 500 records\nQuality score: 90\nFields: customer_id, purchase_amount, date\nSample: [{\"customer_id\": \"C001\", \"purchase_amount\": 150}]",
            "user_question": "What is the average purchase amount?",
            "insights": "Average purchase amount: $125. The data shows consistent purchasing patterns with most customers spending between $100-$150 per transaction. Consider implementing loyalty programs for customers above this threshold."
        }
    ]
    
    with open(filepath, 'w') as f:
        json.dump(sample_data, f, indent=2)
    
    print(f"Sample training file created: {filepath}")
    print("Edit this file with your own training examples, then run the optimization script again.")


def exact_match_metric(gold: str, pred: str) -> float:
    """Simple exact match metric for evaluation"""
    return 1.0 if gold.strip().lower() == pred.strip().lower() else 0.0


def semantic_similarity_metric(gold: str, pred: str) -> float:
    """Placeholder for semantic similarity metric (would use embeddings)"""
    # In production, use sentence transformers or similar
    # For now, return a simple overlap score
    gold_words = set(gold.lower().split())
    pred_words = set(pred.lower().split())
    intersection = gold_words & pred_words
    union = gold_words | pred_words
    return len(intersection) / len(union) if union else 0.0


def optimize_prompts(trainset: List[dspy.Example], valset: List[dspy.Example] = None):
    """Optimize DSPy prompts using BootstrapFewShot"""
    
    # Initialize DSPy with Bedrock
    lm = BedrockLM()
    dspy.configure(lm=lm)
    
    # Initialize the module
    student = DataAnalysisModule()
    
    # Define metric
    metric = semantic_similarity_metric
    
    # Optimize
    print(f"Optimizing with {len(trainset)} training examples...")
    optimizer = BootstrapFewShot(metric=metric, max_bootstrapped_demos=4, max_labeled_demos=8)
    
    optimized_module = optimizer.compile(
        student=student,
        trainset=trainset,
        valset=valset or trainset[:int(len(trainset) * 0.2)]  # Use 20% for validation if not provided
    )
    
    # Evaluate
    if valset:
        print("Evaluating optimized module...")
        evaluate = Evaluate(metric=metric, num_threads=1)
        score = evaluate(optimized_module, valset=valset)
        print(f"Optimized module score: {score}")
    
    # Export optimized prompts
    optimized_prompts = {
        'signature': str(optimized_module.generate_insights.signature),
        'instructions': getattr(optimized_module.generate_insights, 'instructions', ''),
        'few_shot_examples': [
            {
                'data_summary': ex.data_summary,
                'user_question': ex.user_question,
                'insights': ex.insights
            }
            for ex in getattr(optimized_module.generate_insights, 'demos', [])
        ]
    }
    
    return optimized_module, optimized_prompts


def save_optimized_prompts(optimized_prompts: Dict[str, Any], output_path: str):
    """Save optimized prompts to file or DynamoDB"""
    with open(output_path, 'w') as f:
        json.dump(optimized_prompts, f, indent=2)
    
    print(f"Optimized prompts saved to: {output_path}")
    print("\nTo use these prompts:")
    print("1. Review the optimized prompts")
    print("2. Update the DSPy Lambda function to use them")
    print("3. Redeploy the Lambda function")


def main():
    """Main optimization workflow"""
    print("DSPy Prompt Optimization")
    print("=" * 50)
    
    # Load training examples
    trainset = load_training_examples(source='file')
    
    if not trainset:
        print("No training examples found. Please add examples to dspy-training-examples.json")
        return
    
    print(f"Loaded {len(trainset)} training examples")
    
    # Split into train/val sets
    split_idx = int(len(trainset) * 0.8)
    train_examples = trainset[:split_idx]
    val_examples = trainset[split_idx:]
    
    print(f"Training set: {len(train_examples)} examples")
    print(f"Validation set: {len(val_examples)} examples")
    
    # Optimize
    try:
        optimized_module, optimized_prompts = optimize_prompts(train_examples, val_examples)
        
        # Save results
        output_path = os.path.join(os.path.dirname(__file__), 'optimized-dspy-prompts.json')
        save_optimized_prompts(optimized_prompts, output_path)
        
        print("\nOptimization complete!")
        print("\nNext steps:")
        print("1. Review optimized-dspy-prompts.json")
        print("2. Update Lambda function code if needed")
        print("3. Test the optimized prompts")
        print("4. Deploy updated Lambda function")
        
    except Exception as e:
        print(f"Optimization failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()

