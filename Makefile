.PHONY: help install dev start build build-app clean lint test audit update setup
.DEFAULT_GOAL := help

# Couleurs pour l'affichage
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

##@ Aide

help: ## Affiche cette aide
	@echo "$(BLUE)"
	@echo "╔═══════════════════════════════════════════════════════════╗"
	@echo "║         🎵 JukeBox DnD - Commandes Makefile 🎲          ║"
	@echo "╚═══════════════════════════════════════════════════════════╝"
	@echo "$(NC)"
	@awk 'BEGIN {FS = ":.*##"; printf "\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(YELLOW)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
	@echo ""

##@ Installation & Configuration

install: ## Installer toutes les dépendances du projet
	@echo "$(BLUE)📦 Installation des dépendances...$(NC)"
	npm install
	@echo "$(GREEN)✅ Installation terminée !$(NC)"

setup: install ## Premier setup complet du projet (alias de install)
	@echo "$(GREEN)✅ Projet prêt à l'emploi !$(NC)"
	@echo "$(YELLOW)💡 Utilisez 'make dev' pour lancer le mode développement$(NC)"

update: ## Mettre à jour les dépendances
	@echo "$(BLUE)🔄 Mise à jour des dépendances...$(NC)"
	npm update
	@echo "$(GREEN)✅ Mise à jour terminée !$(NC)"

##@ Développement

dev: ## Lancer l'application en mode développement (Vite + Electron)
	@echo "$(BLUE)🚀 Démarrage du mode développement...$(NC)"
	@echo "$(YELLOW)   Vite démarrera sur http://localhost:3000$(NC)"
	@echo "$(YELLOW)   Electron se lancera automatiquement$(NC)"
	npm run dev

dev-nosandbox: ## Mode dev avec sandbox désactivé (fix Linux)
	@echo "$(BLUE)🚀 Démarrage en mode développement (sandbox désactivé)...$(NC)"
	@echo "$(YELLOW)   Vite démarrera sur http://localhost:3000$(NC)"
	ELECTRON_DISABLE_SANDBOX=1 npm run dev

start: ## Lancer l'application Electron en mode production
	@echo "$(BLUE)🚀 Démarrage de l'application...$(NC)"
	npm start

##@ Build & Compilation

build: ## Compiler le frontend (Vite) et builder l'application Electron
	@echo "$(BLUE)🔨 Compilation du projet...$(NC)"
	npm run build
	@echo "$(GREEN)✅ Build terminé !$(NC)"

build-app: ## Builder uniquement l'application Electron (sans recompiler Vite)
	@echo "$(BLUE)🔨 Build de l'application Electron...$(NC)"
	npm run build:app
	@echo "$(GREEN)✅ Application Electron buildée !$(NC)"

build-linux: ## Créer un AppImage pour Linux
	@echo "$(BLUE)🐧 Build pour Linux (AppImage)...$(NC)"
	npm run build:linux
	@echo "$(GREEN)✅ AppImage créé dans dist/ !$(NC)"

build-win: ## Créer un exécutable portable pour Windows
	@echo "$(BLUE)🪟 Build pour Windows (portable .exe)...$(NC)"
	npm run build:win
	@echo "$(GREEN)✅ Exécutable Windows créé dans dist/ !$(NC)"

##@ Qualité de code

audit: ## Vérifier les vulnérabilités de sécurité
	@echo "$(BLUE)🔒 Audit de sécurité...$(NC)"
	npm audit

audit-fix: ## Corriger automatiquement les vulnérabilités
	@echo "$(BLUE)🔧 Correction des vulnérabilités...$(NC)"
	npm audit fix

##@ Nettoyage

clean: ## Nettoyer les fichiers générés (node_modules, dist, build)
	@echo "$(RED)🧹 Nettoyage du projet...$(NC)"
	rm -rf node_modules
	rm -rf dist
	rm -rf build
	rm -rf .vite
	@echo "$(GREEN)✅ Projet nettoyé !$(NC)"

clean-cache: ## Nettoyer uniquement le cache (dist, build, .vite)
	@echo "$(YELLOW)🧹 Nettoyage du cache...$(NC)"
	rm -rf dist
	rm -rf build
	rm -rf .vite
	@echo "$(GREEN)✅ Cache nettoyé !$(NC)"

reset: clean install ## Reset complet : nettoyer et réinstaller
	@echo "$(GREEN)✅ Reset complet terminé !$(NC)"

##@ Informations

info: ## Afficher les informations du projet
	@echo "$(BLUE)ℹ️  Informations du projet$(NC)"
	@echo ""
	@echo "$(GREEN)Nom :$(NC)         JukeBox DnD"
	@echo "$(GREEN)Version :$(NC)     $$(node -p "require('./package.json').version")"
	@echo "$(GREEN)Node.js :$(NC)     $$(node --version)"
	@echo "$(GREEN)npm :$(NC)         $$(npm --version)"
	@echo "$(GREEN)Electron :$(NC)    $$(npm list electron --depth=0 2>/dev/null | grep electron | cut -d'@' -f2 || echo 'non installé')"
	@echo ""

status: ## Vérifier le statut du projet (dépendances installées, etc.)
	@echo "$(BLUE)📊 Statut du projet$(NC)"
	@echo ""
	@if [ -d "node_modules" ]; then \
		echo "$(GREEN)✅ Dépendances installées$(NC)"; \
	else \
		echo "$(RED)❌ Dépendances non installées$(NC) - Utilisez 'make install'"; \
	fi
	@if [ -d "dist" ]; then \
		echo "$(GREEN)✅ Build frontend disponible$(NC)"; \
	else \
		echo "$(YELLOW)⚠️  Pas de build frontend$(NC) - Utilisez 'make build'"; \
	fi
	@if [ -d "electron" ]; then \
		echo "$(GREEN)✅ Dossier Electron présent$(NC)"; \
	else \
		echo "$(RED)❌ Dossier Electron manquant$(NC)"; \
	fi
	@if [ -d "src" ]; then \
		echo "$(GREEN)✅ Dossier source présent$(NC)"; \
	else \
		echo "$(RED)❌ Dossier source manquant$(NC)"; \
	fi
	@echo ""

##@ Utilitaires

logs: ## Afficher les logs npm (si disponibles)
	@echo "$(BLUE)📋 Logs npm...$(NC)"
	@if [ -f "npm-debug.log" ]; then cat npm-debug.log; else echo "$(YELLOW)Aucun log disponible$(NC)"; fi

open-devtools: ## Ouvrir les DevTools Electron (ajouter cette fonctionnalité au code)
	@echo "$(YELLOW)💡 Les DevTools s'ouvrent automatiquement en mode développement$(NC)"
	@echo "$(YELLOW)   Utilisez 'make dev' pour les voir$(NC)"
