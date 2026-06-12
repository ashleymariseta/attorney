'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, theme } from 'antd';

/** Wraps the app with antd's CSS-in-JS SSR registry and applies the brand
 * teal palette to every antd component (DatePicker, Select, etc.). */
export default function AntProvider({ children }: { children: React.ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#0f766e',       // brand-dark
            colorInfo: '#0f766e',
            colorLink: '#0f766e',
            colorBorder: '#e5e7eb',        // line
            colorBgContainer: '#ffffff',
            borderRadius: 8,
            fontFamily: 'var(--font-aldrich), system-ui, -apple-system, sans-serif',
            controlHeight: 40,
          },
          components: {
            DatePicker: {
              activeBorderColor: '#0f766e',
              hoverBorderColor: '#0f766e',
              cellActiveWithRangeBg: '#ccfbf1',
            },
            Select: {
              optionSelectedBg: '#ccfbf1',
            },
            Button: {
              colorPrimary: '#0f766e',
              colorPrimaryHover: '#115e59',
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
