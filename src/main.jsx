import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';
// Boundary de última linha: nenhum erro de render pode deixar a página branca.
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary titulo="Ocorreu um erro inesperado na aplicação"><App/></ErrorBoundary></React.StrictMode>);
