'use client'

import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { getCurrentUser } from 'aws-amplify/auth'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      console.log('Checking if user is already authenticated...')
      try {
        const user = await getCurrentUser()
        console.log('User already authenticated:', user)
        console.log('Redirecting to dashboard...')
        router.push('/dashboard')
      } catch (error) {
        console.log('User not authenticated, staying on login page')
        console.error('Auth check error:', error)
      }
    }
    checkAuth()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to CortexAI
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Multi-tenant AI-powered data processing platform
          </p>
        </div>
        
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <Authenticator
            signUpAttributes={['email', 'given_name', 'family_name']}
            socialProviders={[]}
            hideSignUp={false}
            components={{
              SignUp: {
                FormFields() {
                  return (
                    <>
                      <Authenticator.SignUp.FormFields />
                    </>
                  )
                }
              }
            }}
          >
            {({ signOut, user }) => {
              // This runs when user is authenticated
              if (user) {
                // Redirect immediately when user is authenticated
                router.push('/dashboard')
              }
              
              return <div /> // Return empty div instead of null
            }}
          </Authenticator>
        </div>
      </div>
    </div>
  )
}
