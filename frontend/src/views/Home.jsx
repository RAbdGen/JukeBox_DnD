import React, { useState } from 'react';

const Home = () => {
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleValidate = () => {
    if (selectedFile) {
      alert(`Fichier sélectionné : ${selectedFile.name}`);
    } else {
      alert('Aucun fichier sélectionné.');
    }
  };

  return (
      <div className="p-8">
        <h2 className="text-2xl font-bold mb-4">Accueil</h2>
        <input
          type="file"
          onChange={handleFileChange}
          className="mb-4"
        />
      <br />
<button onClick={handleValidate} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Valider</button>    </div>
  );
};

export default Home;