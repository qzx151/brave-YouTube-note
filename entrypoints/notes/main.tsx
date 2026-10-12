import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { App } from '../../components/App';

const el = document.getElementById('root');
if (!el) throw new Error('root element not found');

createRoot(el).render(
  <React.StrictMode>
    <App surface="tab" />
  </React.StrictMode>,
);
