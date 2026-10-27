import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { Providers } from './components/providers';
import { ThemeProvider } from './components/theme-provider';
import { Toaster } from './components/ui/sonner';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Providers>
        <HashRouter>
          <App />
        </HashRouter>
        <Toaster position="bottom-right" richColors />
      </Providers>
    </ThemeProvider>
  </React.StrictMode>
);
