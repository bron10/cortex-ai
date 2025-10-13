'use client'

import { Amplify } from 'aws-amplify'
import { useEffect, useState } from 'react'
import awsConfig from '@/config/aws-config'

const awsDataConfig = awsConfig || undefined
export default function AmplifyProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isConfigured, setIsConfigured] = useState(false)

  useEffect(() => {
    // Configure Amplify on the client side
    Amplify.configure(awsDataConfig)
    setIsConfigured(true)
  }, [])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Initializing...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
