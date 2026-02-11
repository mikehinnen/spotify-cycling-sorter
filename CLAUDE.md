# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A React web application that organizes Spotify playlists for indoor cycling workouts using a "pyramid sorting" algorithm. Tracks are arranged by energy level to create an optimal workout progression: warm-up (low energy) → peak (high energy in middle) → cool-down (low energy).

## Project Structure

This is a **single-file React artifact** (`spotify-cycling-sorter.jsx`, ~670 lines) designed to run in a React environment (e.g., Vercel artifacts). There is no package.json, build system, or test infrastructure.

**To use:** Import the component into any React application with HTTPS origin.

## Architecture

The main component `SpotifyCyclingSorter` contains:

- **Authentication**: Spotify OAuth 2.0 with PKCE flow (`login()`, `exchangeToken()`)
- **API Layer**: `spotifyFetch()` wrapper for authenticated Spotify Web API calls
- **Core Algorithm**: `pyramidSort(tracks)` - alternates low-energy tracks at edges, high-energy at center
- **Views**: Setup (client ID entry) → Playlists list → Track editor with sorting/saving
- **UI Components**: `EnergyBar` (visualization), `TrackRow` (draggable track item)

## Spotify API Integration

- **Required scopes**: `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`
- **Paginated endpoints**: Playlists (50/request), tracks (100/request), audio features (100/request)
- **Key audio features used**: `energy` (0-1 scale), `tempo` (BPM), `danceability`, `valence`

## Technical Requirements

- Modern browser with Web Crypto API (PKCE hashing)
- HTTPS origin required for Spotify OAuth and crypto API
- Uses `sessionStorage` for PKCE state management
