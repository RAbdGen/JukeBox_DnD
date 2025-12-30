import { Howl, Howler } from 'howler';

// Configuration Howler globale
Howler.volume(0.5);

// Variables globales
let sound = null;
let currentTrackName = 'Epic Fantasy Adventure';

// Fonction pour mettre à jour l'affichage du statut
function updateStatus(status) {
    const statusElement = document.getElementById('track-status');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.className = 'status ' + status.toLowerCase().replace(' ', '-');
    }
}

// Fonction pour mettre à jour le nom du fichier
function updateTrackName(name) {
    const trackElement = document.getElementById('current-track');
    if (trackElement) {
        trackElement.textContent = name;
    }
}

// Initialisation du son de test
function loadTestAudio() {
    // Utilisation d'un fichier audio de test gratuit et libre de droits
    // Source: fichier audio de démonstration
    sound = new Howl({
        src: ['https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'],
        html5: true, // Force HTML5 Audio pour les fichiers en streaming
        loop: false,
        volume: 0.5,
        onload: function () {
            console.log('✅ Fichier audio chargé avec succès');
            updateStatus('Prêt');
            updateTrackName(currentTrackName);
        },
        onloaderror: function (id, error) {
            console.error('❌ Erreur de chargement:', error);
            updateStatus('Erreur de chargement');
            updateTrackName('Fichier introuvable');
        },
        onplay: function () {
            console.log('▶️ Lecture en cours...');
            updateStatus('En lecture');
        },
        onpause: function () {
            console.log('⏸️ Lecture en pause');
            updateStatus('En pause');
        },
        onstop: function () {
            console.log('⏹️ Lecture arrêtée');
            updateStatus('Arrêté');
        },
        onend: function () {
            console.log('✅ Lecture terminée');
            updateStatus('Terminé');
        },
    });
}

// Initialisation de l'interface
document.addEventListener('DOMContentLoaded', () => {
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const volumeSlider = document.getElementById('volume');
    const volumeValue = document.getElementById('volume-value');

    // Charger le fichier audio de test
    loadTestAudio();

    // Gestionnaire Play
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (sound) {
                sound.play();
            } else {
                console.warn('⚠️ Aucun fichier audio chargé');
                updateStatus('Erreur : Aucun fichier');
            }
        });
    }

    // Gestionnaire Pause
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (sound) {
                sound.pause();
            }
        });
    }

    // Gestionnaire Stop
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (sound) {
                sound.stop();
            }
        });
    }

    // Gestionnaire Volume
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            Howler.volume(volume);
            volumeValue.textContent = `${e.target.value}%`;
        });
    }

    console.log('🎵 JukeBox DnD initialisé !');
});
