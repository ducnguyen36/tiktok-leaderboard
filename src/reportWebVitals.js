const reportWebVitals = onPerfEntry => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    // Wrap in try-catch to handle older browsers (like LG WebOS) that may have issues with dynamic imports
    try {
      import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
        getCLS(onPerfEntry);
        getFID(onPerfEntry);
        getFCP(onPerfEntry);
        getLCP(onPerfEntry);
        getTTFB(onPerfEntry);
      }).catch(() => {
        // Silently fail on browsers that don't support web-vitals
      });
    } catch (e) {
      // Silently fail on browsers that don't support dynamic imports
    }
  }
};

export default reportWebVitals;
