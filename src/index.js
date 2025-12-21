import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Detect TV browsers and disable error overlay
const isTV = (() => {
  try {
    const ua = navigator.userAgent.toLowerCase();
    const tvKeywords = ['webos', 'tizen', 'smarttv', 'hbbtv', 'opera tv', 'viera', 'bravia'];
    return tvKeywords.some(kw => ua.includes(kw));
  } catch (e) {
    return false;
  }
})();

// Disable React error overlay on TV browsers
if (isTV && process.env.NODE_ENV === 'development') {
  // Disable the error overlay by patching import.meta or module
  const disableReactErrorOverlay = () => {
    // Try to access and disable the error overlay
    if (typeof window !== 'undefined') {
      // Suppress error events from triggering overlay
      const originalError = console.error;
      console.error = (...args) => {
        // Still log to console but don't trigger overlay
        originalError.apply(console, args);
      };

      // Also add to body class for CSS hiding
      if (document.body) {
        document.body.classList.add('hide-error-overlay');
      }
    }
  };

  disableReactErrorOverlay();

  // Run again after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', disableReactErrorOverlay);
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// Wrapped in try-catch to prevent errors on older browsers (like LG TV WebOS)
try {
  reportWebVitals();
} catch (e) {
  // Silently fail on unsupported browsers
}
