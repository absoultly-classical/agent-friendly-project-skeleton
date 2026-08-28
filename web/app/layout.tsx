import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://learning-meeting.sizes-mildest-2p.chatgpt.site'),
  title: '学习通会议',
  description: '学习通内的通用会议与在线课堂协作空间',
  openGraph: {
    title: '学习通会议',
    description: '让每一次相聚，都沉淀为学习',
    images: [{ url: 'https://learning-meeting.sizes-mildest-2p.chatgpt.site/og.png', width: 1200, height: 630, alt: '学习通会议' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '学习通会议',
    description: '让每一次相聚，都沉淀为学习',
    images: ['https://learning-meeting.sizes-mildest-2p.chatgpt.site/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
