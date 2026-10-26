import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './styles/styles.css';
// Boundary de última linha: nenhum erro de render pode deixar a página branca.
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary titulo="Ocorreu um erro inesperado na aplicação"><App/></ErrorBoundary></React.StrictMode>);
