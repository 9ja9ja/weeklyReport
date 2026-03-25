import type { Metadata } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'

export const metadata: Metadata = {
  title: '팀 주간보고 시스템',
  description: '주간보고 작성 및 취합 웹 서비스',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        <Navigation />
        <main className="container">
          {children}
        </main>
      </body>
    </html>
  )
}
