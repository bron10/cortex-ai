'use client'

import { useState, useEffect, useRef } from 'react'
import { Brain, FileText, BarChart3, TrendingUp, AlertCircle, CheckCircle, Clock, X, Send, Sparkles } from 'lucide-react'
import { get } from 'aws-amplify/api'
import { fetchAuthSession } from 'aws-amplify/auth'

interface InsightHistoryItem {
  timestamp: string
  userId: string
  prompt: string
  response: string
}

interface FileData {
  dataId: string
  tenantId: string
  timestamp: string
  status: string
  fileName?: string
  fileSize?: number
  uploadedAt?: string
  processingResults?: {
    qualityScore?: number
    dataSize?: number
    extractedFields?: string[]
    validationStatus?: string
    recordCount?: number
  }
  aiInsights?: {
    summary?: string
    riskFactors?: string[]
    dataQualityNotes?: string[]
    confidence?: number
    keyInsights?: string[]
    recommendations?: string[]
    opportunities?: string[]
    modelUsed?: string
  }
  insights?: InsightHistoryItem[] // Insight history
  lastInsightAt?: string
  insightCount?: number
}

interface FileAnalysisProps {
  file: FileData | null
  onClose: () => void
}

export default function FileAnalysis({ file, onClose }: FileAnalysisProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [analysisData, setAnalysisData] = useState<any>(null)
  const [prompt, setPrompt] = useState('')
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false)
  const [additionalInsights, setAdditionalInsights] = useState<string>('')
  const [showHistory, setShowHistory] = useState(false)
  const [useDspy, setUseDspy] = useState(() => {
    // Load preference from localStorage, default to true
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('useDspy')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })
  const insightsScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (file) {
      setIsLoading(true)
      // Use the actual file data from API response
      setTimeout(() => {
        setAnalysisData(file)
        setIsLoading(false)
      }, 500) // Reduced loading time since we have real data
    }
  }, [file])

  // Auto-scroll to bottom when insights are updated
  useEffect(() => {
    if (additionalInsights && insightsScrollRef.current) {
      insightsScrollRef.current.scrollTop = insightsScrollRef.current.scrollHeight
    }
  }, [additionalInsights])

  // Save useDspy preference to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('useDspy', useDspy.toString())
    }
  }, [useDspy])

  const generateEnhancedInsights = (fileData: FileData) => {
    // Generate enhanced insights based on existing data
    const insights = {
      dataQuality: {
        score: fileData.processingResults?.qualityScore || 85,
        completeness: Math.round((fileData.processingResults?.recordCount || 0) * 0.9)
      },
      patterns: [
        'Data shows consistent growth patterns over time',
        'Strong correlation between key metrics',
        'Seasonal variations detected in quarterly data'
      ],
      recommendations: [
        'Consider implementing data validation rules',
        'Add automated quality checks for incoming data',
        'Set up alerts for data anomalies'
      ],
      trends: [
        'Upward trend in user engagement metrics',
        'Decreasing error rates over time',
        'Stable performance indicators'
      ]
    }
    return insights
  }

  const generateAdditionalInsights = async () => {
    if (!prompt.trim() || !file) return

    // Validate prompt length
    if (prompt.length > 100) {
      setAdditionalInsights('Error: Prompt is too long. Please limit your question to 100 characters.')
      return
    }

    setIsGeneratingInsights(true)
    try {
      // Get the current user's session token
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()
      
      if (!token) {
        throw new Error('No authentication token found. Please sign in again.')
      }

      // Call the insights API with the prompt
      const response = await get({
        apiName: 'CortexAI',
        path: 'insights',
        options: {
          queryParams: {
            dataId: file.dataId,
            prompt: prompt,
            useDspy: useDspy.toString()
          },
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      })

      const responseData = await response.response

      console.log("responseData", responseData)
      const responseBody = typeof responseData.body === 'string' 
        ? JSON.parse(responseData.body) 
        : responseData.body
      
      console.log("responseBody", responseBody)
      setAdditionalInsights(responseBody.insights || 'No additional insights generated.')
      
      // Update the insights history in the local state
      if (responseBody.insightHistory) {
        setAnalysisData((prev: any) => ({
          ...prev,
          insights: responseBody.insightHistory,
          insightCount: responseBody.insightHistory.length,
          lastInsightAt: responseBody.insightHistory[responseBody.insightHistory.length - 1]?.timestamp
        }))
      }
      
      setPrompt('') // Clear the input after successful response
    } catch (error) {
      console.error('Error generating additional insights:', error)
      setAdditionalInsights('Error generating insights. Please try again.')
    } finally {
      setIsGeneratingInsights(false)
    }
  }

  if (!file) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Brain className="h-6 w-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">File Analysis</h2>
              <p className="text-sm text-gray-500">{file.tenantId} - {file.dataId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-4">Analyzing data...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* File Overview */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  File Overview
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {analysisData?.processingResults?.recordCount || 'N/A'}
                    </div>
                    <div className="text-sm text-gray-500">Records</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {analysisData?.processingResults?.qualityScore || 'N/A'}%
                    </div>
                    <div className="text-sm text-gray-500">Quality Score</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {analysisData?.processingResults?.dataSize ? `${(analysisData.processingResults.dataSize / 1024).toFixed(1)}KB` : 'N/A'}
                    </div>
                    <div className="text-sm text-gray-500">File Size</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {analysisData?.processingResults?.extractedFields?.length || 'N/A'}
                    </div>
                    <div className="text-sm text-gray-500">Fields</div>
                  </div>
                </div>
              </div>

              {/* AI Insights */}
              {analysisData?.aiInsights && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-3 flex items-center">
                    <Brain className="h-5 w-5 mr-2" />
                    AI Insights
                  </h3>
                  <div className="space-y-3">
                    {analysisData.aiInsights.summary && (
                      <div>
                        <h4 className="font-medium text-blue-800 mb-1">Summary</h4>
                        <p className="text-blue-700 text-sm">{analysisData.aiInsights.summary}</p>
                      </div>
                    )}
                    {analysisData.aiInsights.keyInsights && analysisData.aiInsights.keyInsights.length > 0 && (
                      <div>
                        <h4 className="font-medium text-blue-800 mb-1">Key Insights</h4>
                        <ul className="list-disc list-inside text-blue-700 text-sm space-y-1">
                          {analysisData.aiInsights.keyInsights.map((insight: string, index: number) => (
                            <li key={index}>{insight}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysisData.aiInsights.confidence && (
                      <div>
                        <h4 className="font-medium text-blue-800 mb-1">Confidence Level</h4>
                        <div className="flex items-center">
                          <div className="w-32 bg-blue-200 rounded-full h-2 mr-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full" 
                              style={{ width: `${analysisData.aiInsights.confidence * 100}%` }}
                            ></div>
                          </div>
                          <span className="text-blue-800 font-medium">
                            {Math.round(analysisData.aiInsights.confidence * 100)}%
                          </span>
                        </div>
                      </div>
                    )}
                    {analysisData.aiInsights.modelUsed && (
                      <div>
                        <h4 className="font-medium text-blue-800 mb-1">Analysis Model</h4>
                        <p className="text-blue-700 text-sm">{analysisData.aiInsights.modelUsed}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Data Quality Analysis */}
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="font-semibold text-green-900 mb-3 flex items-center">
                  <CheckCircle className="h-5 w-5 mr-2" />
                  Data Quality Analysis
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-green-800">Overall Quality Score</span>
                    <div className="flex items-center">
                      <div className="w-32 bg-green-200 rounded-full h-2 mr-2">
                        <div 
                          className="bg-green-600 h-2 rounded-full" 
                          style={{ width: `${analysisData?.processingResults?.qualityScore || 0}%` }}
                        ></div>
                      </div>
                      <span className="text-green-800 font-medium">
                        {analysisData?.processingResults?.qualityScore || 0}%
                      </span>
                    </div>
                  </div>
                  {analysisData?.processingResults?.validationStatus && (
                    <div>
                      <h4 className="font-medium text-green-800 mb-1">Validation Status</h4>
                      <span className={`px-2 py-1 rounded text-sm ${
                        analysisData.processingResults.validationStatus === 'VALID' 
                          ? 'bg-green-200 text-green-800' 
                          : 'bg-red-200 text-red-800'
                      }`}>
                        {analysisData.processingResults.validationStatus}
                      </span>
                    </div>
                  )}
                  {analysisData?.processingResults?.extractedFields && (
                    <div>
                      <h4 className="font-medium text-green-800 mb-1">Extracted Fields ({analysisData.processingResults.extractedFields.length})</h4>
                      <div className="flex flex-wrap gap-1">
                        {analysisData.processingResults.extractedFields.map((field: string, index: number) => (
                          <span key={index} className="px-2 py-1 bg-green-200 text-green-800 text-xs rounded">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Patterns & Trends */}
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-semibold text-purple-900 mb-3 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2" />
                  Patterns & Trends
                </h3>
                <div className="space-y-3">
                  {analysisData?.enhancedInsights?.patterns?.map((pattern: string, index: number) => (
                    <div key={index} className="flex items-start">
                      <BarChart3 className="h-4 w-4 text-purple-600 mr-2 mt-0.5 flex-shrink-0" />
                      <span className="text-purple-700 text-sm">{pattern}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-yellow-50 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-900 mb-3 flex items-center">
                  <AlertCircle className="h-5 w-5 mr-2" />
                  Recommendations
                </h3>
                <div className="space-y-2">
                  {analysisData?.aiInsights?.recommendations?.map((recommendation: string, index: number) => (
                    <div key={index} className="flex items-start">
                      <div className="w-2 h-2 bg-yellow-600 rounded-full mr-3 mt-2 flex-shrink-0"></div>
                      <span className="text-yellow-800 text-sm">{recommendation}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Opportunities */}
              {analysisData?.aiInsights?.opportunities && analysisData.aiInsights.opportunities.length > 0 && (
                <div className="bg-indigo-50 rounded-lg p-4">
                  <h3 className="font-semibold text-indigo-900 mb-3 flex items-center">
                    <Sparkles className="h-5 w-5 mr-2" />
                    Opportunities
                  </h3>
                  <div className="space-y-2">
                    {analysisData.aiInsights.opportunities.map((opportunity: string, index: number) => (
                      <div key={index} className="flex items-start">
                        <div className="w-2 h-2 bg-indigo-600 rounded-full mr-3 mt-2 flex-shrink-0"></div>
                        <span className="text-indigo-800 text-sm">{opportunity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Factors */}
              {analysisData?.aiInsights?.riskFactors && analysisData.aiInsights.riskFactors.length > 0 && (
                <div className="bg-red-50 rounded-lg p-4">
                  <h3 className="font-semibold text-red-900 mb-3 flex items-center">
                    <AlertCircle className="h-5 w-5 mr-2" />
                    Risk Factors
                  </h3>
                  <div className="space-y-2">
                    {analysisData.aiInsights.riskFactors.map((risk: string, index: number) => (
                      <div key={index} className="flex items-start">
                        <div className="w-2 h-2 bg-red-600 rounded-full mr-3 mt-2 flex-shrink-0"></div>
                        <span className="text-red-800 text-sm">{risk}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Processing Status */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Clock className="h-5 w-5 mr-2" />
                  Processing Status
                </h3>
                <div className="flex items-center">
                  <div className={`w-3 h-3 rounded-full mr-3 ${
                    analysisData?.status === 'INSIGHTS_GENERATED' ? 'bg-green-500' : 
                    analysisData?.status === 'PROCESSING' ? 'bg-yellow-500' : 
                    'bg-gray-400'
                  }`}></div>
                  <span className="text-gray-700 capitalize">
                    {analysisData?.status?.toLowerCase().replace('_', ' ') || 'Unknown'}
                  </span>
                </div>
              </div>

              {/* Insight History */}
              {analysisData?.insights && analysisData.insights.length > 0 && (
                <div className="bg-gradient-to-r from-green-50 to-teal-50 rounded-lg p-4 border border-green-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 flex items-center">
                      <Clock className="h-5 w-5 mr-2 text-green-600" />
                      Insight History ({analysisData.insightCount || 0})
                    </h3>
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {showHistory ? 'Hide' : 'Show'} History
                    </button>
                  </div>
                  
                  {showHistory && (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {analysisData.insights.map((insight: InsightHistoryItem, index: number) => (
                        <div key={index} className="bg-white rounded-md p-3 border border-green-200 shadow-sm">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center text-xs text-gray-500">
                              <Clock className="h-3 w-3 mr-1" />
                              {new Date(insight.timestamp).toLocaleString()}
                            </div>
                            <span className="text-xs text-gray-400">#{analysisData.insights.length - index}</span>
                          </div>
                          <div className="mb-2">
                            <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Question:</span>
                            <p className="text-sm text-gray-900 mt-1">{insight.prompt}</p>
                          </div>
                          <div>
                            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Answer:</span>
                            <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap leading-relaxed">{insight.response}</p>
                          </div>
                        </div>
                      )).reverse()}
                    </div>
                  )}
                  
                  {analysisData.lastInsightAt && (
                    <p className="text-xs text-gray-500 mt-2">
                      Last insight: {new Date(analysisData.lastInsightAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Additional Insights Prompt */}
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Brain className="h-5 w-5 mr-2" />
                  Generate Additional Insights
                </h3>
                <div className="space-y-3">
                  {/* Scrollable Insights Display */}
                  {additionalInsights && (
                    <div 
                      ref={insightsScrollRef}
                      className="max-h-64 overflow-y-auto p-3 bg-white rounded-md border border-blue-200 mb-3 scroll-smooth"
                    >
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center sticky top-0 bg-white pb-2 border-b border-blue-100">
                        <Sparkles className="h-4 w-4 mr-2 text-blue-600" />
                        AI-Generated Insights
                      </h4>
                      <div className="text-gray-700 text-sm whitespace-pre-wrap leading-relaxed">
                        {additionalInsights}
                      </div>
                    </div>
                  )}

                  {/* DSPy Toggle */}
                  <div className="flex items-center mb-3 p-2 bg-white rounded-md border border-gray-200">
                    <input
                      type="checkbox"
                      id="useDspy"
                      checked={useDspy}
                      onChange={(e) => setUseDspy(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="useDspy" className="ml-2 text-sm text-gray-700 cursor-pointer">
                      <span className="font-medium">Use DSPy Optimization</span>
                      <span className="text-gray-500 ml-1">(Enhanced AI insights with optimized prompts)</span>
                    </label>
                  </div>

                  {/* Prompt Input */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Ask a specific question about your data:
                      </label>
                      <span className={`text-xs ${prompt.length > 100 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        {prompt.length}/100
                      </span>
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && prompt.trim() && !isGeneratingInsights && prompt.length <= 100) {
                            generateAdditionalInsights()
                          }
                        }}
                        placeholder="e.g., Peak hours? Popular payment methods?"
                        className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 text-gray-900 ${
                          prompt.length > 100 
                            ? 'border-red-300 focus:ring-red-500' 
                            : 'border-gray-300 focus:ring-blue-500'
                        }`}
                        disabled={isGeneratingInsights}
                        maxLength={110}
                      />
                      <button
                        onClick={generateAdditionalInsights}
                        disabled={!prompt.trim() || isGeneratingInsights || prompt.length > 100}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                      >
                        {isGeneratingInsights ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Generating...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-2" />
                            Generate
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Press Enter or click Generate to get AI-powered insights (max 100 characters)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
