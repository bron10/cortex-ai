'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth'
import { get, post } from 'aws-amplify/api'
import { Upload, FileText, Brain, LogOut, User, Eye } from 'lucide-react'
import FileAnalysis from '../../components/FileAnalysis'

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
  processingResults?: any
  aiInsights?: any
  insights?: InsightHistoryItem[]
  lastInsightAt?: string
  insightCount?: number
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [files, setFiles] = useState<FileData[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileData, setSelectedFileData] = useState<FileData | null>(null)
  const [tenantId, setTenantId] = useState('')

  useEffect(() => {
    checkAuth()
    loadFiles()
  }, [])

  const checkAuth = async () => {
    console.log('Starting authentication check...')
    try {
      const currentUser = await getCurrentUser()
      console.log('User authenticated:', currentUser)
      setUser(currentUser)
    } catch (error) {
      console.error('Authentication error:', error)
      console.log('Redirecting to login page...')
      router.push('/')
    } finally {
      console.log('Setting loading to false')
      setLoading(false)
    }
  }

  const loadFiles = async () => {
    

    console.log('Loading files for tenant:', tenantId)

    try {
      setLoadingFiles(true)
      
      // Get the current user's session token
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()
      
      if (!token) {
        throw new Error('No authentication token found. Please sign in again.')
      }

      console.log('Making API call to get all files')
      console.log('Auth token exists:', !!token)

      // Call the API Gateway endpoint to fetch files
      const response = await get({
        apiName: 'CortexAI',
        path: 'files',
        options: {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      })

      // Parse the response body - AWS Amplify returns response.response as a Promise
      const responseData = await response.response
      console.log('Response data:', responseData)
      console.log('Response body:', responseData.body)
      
      // Try to parse the body directly
      const responseBody = typeof responseData.body === 'string' 
        ? JSON.parse(responseData.body) 
        : responseData.body
      const {files} = await  responseBody.json()
      console.log('Files API response:', files)
      setFiles(files || [])
    } catch (error) {
      console.error('Error loading files:', error)
      setFiles([])
      // Don't throw the error to prevent page refresh
      // Just log it and show empty state
    } finally {
      setLoadingFiles(false)
    }
  }

  const handleFileUpload = async () => {
    if (!selectedFile || !tenantId.trim()) {
      alert('Please select a file and enter a tenant ID')
      return
    }

    // Validate file type
    const extension = selectedFile.name.split('.').pop()?.toLowerCase()
    if (!extension || !['json', 'csv'].includes(extension)) {
      alert('Please select a JSON or CSV file')
      return
    }

    setUploading(true)
    try {
      // Get the current user's session token
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()
      
      if (!token) {
        throw new Error('No authentication token found. Please sign in again.')
      }

      console.log('Starting file upload...')
      console.log('File:', selectedFile.name, 'Size:', selectedFile.size)
      console.log('Tenant ID:', tenantId.trim())
      
      // Process the file first
      const processedData = await processFile(selectedFile)
      console.log('Processed data preview:', Array.isArray(processedData) ? `${processedData.length} records` : 'Object data')
      
      // Upload to API Gateway
      const response = await post({
        apiName: 'CortexAI',
        path: 'upload',
        options: {
          body: {
            tenantId: tenantId.trim(),
            data: processedData,
            metadata: {
              fileName: selectedFile.name,
              fileSize: selectedFile.size,
              uploadedAt: new Date().toISOString()
            }
          },
          headers: {
            'X-Tenant-ID': tenantId.trim(),
            'Authorization': `Bearer ${token}`
          }
        }
      })

      // Parse the upload response
      const responseData = await response.response
      const uploadResult = typeof responseData.body === 'string' 
        ? JSON.parse(responseData.body) 
        : responseData.body
      
      console.log('Upload response:', uploadResult)
      
      if (uploadResult.success) {
        // Clear the file input
        setSelectedFile(null)
        
        // Show success message with data ID
        alert(`File uploaded successfully!\nData ID: ${uploadResult.dataId}\nRefreshing files list...`)
        
        // Reload files after a short delay to allow processing
        setTimeout(() => {
          console.log('Reloading files after upload...')
          loadFiles()
        }, 1000)
      } else {
        throw new Error(uploadResult.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Upload failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.'
      alert(`Upload failed: ${errorMessage}`)
    } finally {
      setUploading(false)
    }
  }

  const csvToJson = (csvText: string): any[] => {
    const lines = csvText.trim().split('\n')
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header and one data row')
    }
    
    const headers = lines[0].split(',').map(h => h.trim())
    const data = []
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim())
      if (values.length !== headers.length) {
        throw new Error(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`)
      }
      
      const row: any = {}
      headers.forEach((header, index) => {
        // Try to parse as number, boolean, or keep as string
        const value = values[index]
        if (value === 'true') row[header] = true
        else if (value === 'false') row[header] = false
        else if (!isNaN(Number(value)) && value !== '') row[header] = Number(value)
        else row[header] = value
      })
      data.push(row)
    }
    
    return data
  }

  const processFile = async (file: File): Promise<any> => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string
          
          switch (extension) {
            case 'json':
              resolve(JSON.parse(content))
              break
            case 'csv':
              resolve(csvToJson(content))
              break
            default:
              reject(new Error('Unsupported file type. Please use JSON or CSV files.'))
          }
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/')
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  const handleViewAnalysis = (file: FileData) => {
    setSelectedFileData(file)
  }

  const handleCloseAnalysis = () => {
    setSelectedFileData(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Brain className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">CortexAI Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-sm text-gray-600">
                <User className="h-4 w-4 mr-2" />
                {user?.username}
              </div>
              <button
                onClick={handleSignOut}
                className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Upload className="h-5 w-5 mr-2" />
            Upload Data
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tenant ID *
              </label>
              <input
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="Enter tenant ID (e.g., tenant-123, company-abc)"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                This identifies which tenant/organization this data belongs to
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Data File (JSON or CSV)
              </label>
              <input
                type="file"
                accept=".json,.csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supported formats: JSON (.json), CSV (.csv)
              </p>
            </div>

            <button
              onClick={handleFileUpload}
              disabled={!selectedFile || !tenantId.trim() || uploading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Upload Data'}
            </button>
          </div>
        </div>

        {/* Files List */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            Uploaded Files
          </h2>
          
          {loadingFiles ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading files...</p>
            </div>
          ) : files.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No files uploaded yet.</p>
          ) : (
            <div className="space-y-4">
              {files.map((file) => (
                <div key={file.dataId} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {file.tenantId} - {file.dataId}
                      </h3>
                      <p className="text-sm text-gray-500">
                        Uploaded: {new Date(file.timestamp).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">
                        Status: <span className="capitalize">{file.status.toLowerCase().replace('_', ' ')}</span>
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        {file.processingResults && (
                          <p className="text-sm text-gray-600">
                            Records: {file.processingResults.recordCount}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleViewAnalysis(file)}
                        className="flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View Analysis
                      </button>
                    </div>
                  </div>
                  
                  {file.aiInsights && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-md">
                      <h4 className="font-medium text-blue-900 mb-2 flex items-center">
                        <Brain className="h-4 w-4 mr-2" />
                        AI Insights
                      </h4>
                      <p className="text-sm text-blue-800">{file.aiInsights.summary}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File Analysis Modal */}
      <FileAnalysis 
        file={selectedFileData} 
        onClose={handleCloseAnalysis} 
      />
    </div>
  )
}
