import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { App } from '../../components/App';
import { buildMarkdownZip, serializeNote } from '../../lib/exporter';
import { getNote } from '../../lib/db';

// 自动化测试钩子：仅当以 ?test=1 打开时挂载，不影响正常使用
if (new URLSearchParams(window.location.search).get('test') === '1') {
  Object.assign(window, {
    __test: {
      buildMarkdownZip,
      serializeNote,
      getNote,
    },
  });
}

const el = document.getElementById('root');
if (!el) throw new Error('root element not found');

createRoot(el).render(
  <React.StrictMode>
    <App surface="sidepanel" />
  </React.StrictMode>,
);
