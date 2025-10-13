import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import AmplifyProvider from '@/components/AmplifyProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CortexAI - Multi-tenant Data Platform',
  description: 'AI-powered data processing platform with multi-tenant architecture',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AmplifyProvider>
          <div className="min-h-screen bg-gray-50">
            {children}
          </div>
        </AmplifyProvider>
      </body>
    </html>
  )
}
