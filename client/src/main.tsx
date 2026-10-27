import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import App from'./App';import'./theme.css';import'./reference-overrides.css';import'./mobile-fixes.css';import'./ticket-drawer.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);
