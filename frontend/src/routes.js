import { HashRouter, Routes, Route } from 'react-router-dom'
import Home from './views/Home.jsx';

export default () => (
    <HashRouter>
        <Routes>
            <Route path="/" element={<Home />} />
        </Routes>
    </HashRouter>
);

