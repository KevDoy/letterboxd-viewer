// Letterboxd Export Viewer
class LetterboxdViewer {
    constructor() {
        this.data = {
            profile: null,
            diary: [],
            watched: [],
            ratings: [],
            reviews: [],
            watchlist: [],
            comments: [],
            lists: [],
            likes: {
                films: [],
                reviews: [],
                lists: []
            },
            deleted: {},
            orphaned: {}
        };
        
        this.tmdbCache = new Map();
        this.TMDB_API_KEY = 'your_actual_api_key_here'; // Users will need to add their own API key
        this.TMDB_BASE_URL = 'https://api.themoviedb.org/3';
        this.TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
        
        this.currentSection = 'dashboard';
        
        // User management
        this.users = [];
        this.currentUser = null;
        
        // Chart instances
        this.monthlyChart = null;
        this.ratingChart = null;
        this.monthlyChartRange = '12months'; // Default to 12 months
        
        // Loading state management
        this.loadingStates = {
            dashboard: false,
            diary: false,
            allFilms: false,
            watchlist: false,
            reviews: false,
            lists: false
        };
        
        // TMDB connectivity tracking
        this.tmdbConnectivity = {
            isOnline: true,
            hasShownOfflineToast: false,
            lastErrorTime: null
        };
        
        // Fallback poster cycling
        this.fallbackPosterCount = 18; // Number of fallback posters (01.jpeg through 18.jpeg)
        this.posterIndexCache = new Map(); // Cache poster assignments for consistency
        
        // Pagination and sorting state
        this.pagination = {
            diary: { page: 1, limit: 32, sortBy: 'date-desc', sortOrder: 'desc' },
            watchlist: { page: 1, limit: 32, sortBy: 'date-desc', sortOrder: 'desc' },
            reviews: { page: 1, limit: 10, sortBy: 'date-desc', sortOrder: 'desc' },
            watched: { page: 1, limit: 32, sortBy: 'year-desc', sortOrder: 'desc' },
            allFilms: { page: 1, limit: 32, sortBy: 'year-desc', sortOrder: 'desc', ratingFilter: '' }
        };
        
        this.init();
    }

    // Determine if a usable TMDB API key is configured
    hasValidTMDBKey() {
        const key = (this.TMDB_API_KEY || '').trim();
        if (!key) return false;
        const placeholders = new Set([
            'YOUR_TMDB_API_KEY',
            'your_actual_api_key_here',
            'your_api_key_here',
        ]);
        return !placeholders.has(key);
    }

    // Determine Letterboxd username, preferring the export profile value
    getLetterboxdUsername() {
        const fromProfile = (this.data && this.data.profile && this.data.profile.Username) ? String(this.data.profile.Username).trim() : '';
        if (fromProfile) return fromProfile;
        const fromConfig = (this.currentUser && this.currentUser.letterboxdUsername) ? String(this.currentUser.letterboxdUsername).trim() : '';
        if (fromConfig) return fromConfig;
        // Fallback to user id as last resort
        return this.currentUser ? String(this.currentUser.id || '').trim() : '';
    }

    // Internal: check if live is enabled for the current user
    isLiveEnabledForCurrentUser() {
        if (!this.currentUser) return false;
        const key = `live_enabled_${this.currentUser.id}`;
        const stored = localStorage.getItem(key);
        if (stored == null && this._liveDataState && this._liveDataState[this.currentUser.id] != null) {
            return !!this._liveDataState[this.currentUser.id];
        }
        return stored === 'true';
    }
    
    async init() {
        try {
            await this.loadUsers();
            
            // Check if we have users available
            if (this.users.length === 0) {
                this.showError('No users found and no valid letterboxd-export data detected. Please check your setup.');
                return;
            }
            
            // If we're in single user mode or only have one user, load directly
            if (this.users.length === 1 || this.users[0].isSingleUserMode) {
                this.currentUser = this.users[0];
                
                // Show appropriate loading message
                const loadingMessage = this.currentUser.isSingleUserMode 
                    ? 'Loading your Letterboxd data...'
                    : `Loading ${this.currentUser.displayName}'s data...`;
                
                document.getElementById('loading-screen').innerHTML = `
                    <div class="d-flex justify-content-center align-items-center min-vh-100">
                        <div class="text-center">
                            <div class="spinner-border text-primary mb-3" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            <h5>${loadingMessage}</h5>
                        </div>
                    </div>
                `;
                
                await this.loadUserData();
                this.hideLoading();
                this.showNavigation();
                this.showDashboard();
                this.updateNavigation();
                // In single-user mode, profile is now clickable to open the switcher
            } else {
                // Multiple users available - show user selection interface
                this.showUserSelection();
                return;
            }
        } catch (error) {
            console.error('Error initializing app:', error);
            this.showError('Failed to load Letterboxd data. Please check that all CSV files are present in the letterboxd-export folder.');
        }
    }
    
    async loadUsers() {
        try {
            const response = await fetch('letterboxd-export/users.json');
            if (!response.ok) {
                console.log('users.json not found, switching to single user mode');
                // Single user mode - expect data directly in letterboxd-export folder
                this.users = [{
                    id: 'default',
                    displayName: 'User',
                    folder: '.',
                    isSingleUserMode: true
                }];
                return;
            }
            
            const config = await response.json();
            this.users = config.users || config || [];
            
            // If users.json exists but is empty or malformed, fall back to single user mode
            if (!Array.isArray(this.users) || this.users.length === 0) {
                console.warn('users.json exists but contains no valid users, falling back to single user mode');
                this.users = [{
                    id: 'default',
                    displayName: 'User',
                    folder: '.',
                    isSingleUserMode: true
                }];
            }
        } catch (error) {
            console.log('Error loading users.json, switching to single user mode:', error.message);
            // Single user mode - expect data directly in letterboxd-export folder
            this.users = [{
                id: 'default',
                displayName: 'User',
                folder: '.',
                isSingleUserMode: true
            }];
        }
    }
    
    showUserSelection() {
        const container = document.getElementById('loading-screen');
        container.classList.remove('d-none');
        
        let html = `
            <div class="container">
                <div class="row justify-content-center">
                    <div class="col-md-6">
                        <!-- App Branding -->
                        <div class="text-center mb-4">
                            <div class="d-flex justify-content-center align-items-center mb-2">
                                <img src="img/logo.png" alt="Logo" width="32" height="32" class="me-3">
                                <h2 class="mb-0 text-light">Letterboxd Viewer</h2>
                            </div>
                        </div>
                        
                        <div class="card user-selection-card">
                            <div class="card-header text-center">
                                <h4><i class="bi bi-person-circle"></i> Select User</h4>
                                <p class="mb-0 text-muted">Choose which Letterboxd export to view</p>
                            </div>
                            <div class="card-body">
        `;
        
        for (const user of this.users) {
            const lastUpdated = user.lastUpdated ? new Date(user.lastUpdated).toLocaleDateString() : 'Unknown';
            html += `
                <button class="btn btn-outline-primary user-select-btn mb-2 w-100" 
                        onclick="app.selectUser('${user.id}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="text-start">
                            <div><i class="bi bi-person"></i> ${user.displayName}</div>
                            <small class="text-muted">Last updated: ${lastUpdated}</small>
                        </div>
                        <i class="bi bi-chevron-right"></i>
                    </div>
                </button>
            `;
        }
        
        html += `
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;

        // In multi-user mode, surface TMDB status toasts immediately on the selection screen
        try {
            this.checkTMDBStatusOnUserSelect();
        } catch (e) {
            // non-blocking
        }
    }

    // Proactively check TMDB key and connectivity on user select screen (multi-user mode)
    async checkTMDBStatusOnUserSelect() {
        // If user has dismissed TMDB errors permanently, skip
        if (localStorage.getItem('tmdb_errors_dismissed') === 'true') return;

        // Missing or placeholder key
        if (!this.hasValidTMDBKey()) {
            this.handleTMDBConnectivityError('no_api_key');
            return;
        }

        // With a key, do a tiny configuration check to validate key and connectivity
        try {
            const url = `${this.TMDB_BASE_URL}/configuration?api_key=${this.TMDB_API_KEY}`;
            const resp = await fetch(url, { method: 'GET' });
            if (resp.status === 401) {
                // Invalid/unauthorized key
                this.handleTMDBConnectivityError('invalid_api_key');
                return;
            }
            if (!resp.ok) {
                // Other HTTP errors
                this.handleTMDBConnectivityError('connectivity');
                return;
            }
            // OK: mark as online
            this.tmdbConnectivity.isOnline = true;
        } catch (_) {
            // Network failure
            this.handleTMDBConnectivityError('connectivity');
        }
    }
    
    async selectUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) {
            console.error('User not found:', userId);
            return;
        }
        
        this.currentUser = user;
        
        // Show loading state
        document.getElementById('loading-screen').innerHTML = `
            <div class="d-flex justify-content-center align-items-center min-vh-100">
                <div class="text-center">
                    <div class="spinner-border text-primary mb-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <h5>Loading ${user.displayName}'s data...</h5>
                </div>
            </div>
        `;
        
        try {
            await this.loadUserData();
            this.hideLoading();
            this.showNavigation();
            this.showDashboard();
            this.updateNavigation();
        } catch (error) {
            console.error('Error loading user data:', error);
            this.showError(`Failed to load data for ${user.displayName}. Please check that all CSV files are present.`);
        }
    }
    
    async loadUserData() {
        // Reset data
        this.data = {
            profile: null,
            diary: [],
            watched: [],
            ratings: [],
            reviews: [],
            watchlist: [],
            comments: [],
            lists: [],
            likes: {
                films: [],
                reviews: [],
                lists: []
            },
            deleted: {},
            orphaned: {}
        };
        
        const basePath = this.currentUser.folder === '.' ? 'letterboxd-export' : `letterboxd-export/${this.currentUser.folder}`;
        
        const loadingPromises = [
            this.loadCSV(`${basePath}/profile.csv`, 'profile'),
            this.loadCSV(`${basePath}/diary.csv`, 'diary'),
            this.loadCSV(`${basePath}/watched.csv`, 'watched'),
            this.loadCSV(`${basePath}/ratings.csv`, 'ratings'),
            this.loadCSV(`${basePath}/reviews.csv`, 'reviews'),
            this.loadCSV(`${basePath}/watchlist.csv`, 'watchlist'),
            this.loadCSV(`${basePath}/comments.csv`, 'comments'),
            this.loadLikes(basePath),
            this.loadLists(basePath)
        ];
        
        await Promise.all(loadingPromises);
        this.processData();
    }
    
    async loadAllData() {
        const loadingPromises = [
            this.loadCSV('letterboxd-export/profile.csv', 'profile'),
            this.loadCSV('letterboxd-export/diary.csv', 'diary'),
            this.loadCSV('letterboxd-export/watched.csv', 'watched'),
            this.loadCSV('letterboxd-export/ratings.csv', 'ratings'),
            this.loadCSV('letterboxd-export/reviews.csv', 'reviews'),
            this.loadCSV('letterboxd-export/watchlist.csv', 'watchlist'),
            this.loadCSV('letterboxd-export/comments.csv', 'comments'),
            this.loadLikes(),
            this.loadLists()
        ];
        
        await Promise.all(loadingPromises);
        this.processData();
    }
    
    async loadCSV(path, dataKey) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                console.warn(`Could not load ${path}: ${response.status}`);
                return;
            }
            
            const text = await response.text();
            const data = this.parseCSV(text);
            
            if (dataKey === 'profile' && data.length > 0) {
                this.data[dataKey] = data[0]; // Profile is a single record
            } else {
                this.data[dataKey] = data;
            }
        } catch (error) {
            console.warn(`Error loading ${path}:`, error);
        }
    }
    
    async loadLikes(basePath = 'letterboxd-export') {
        const likeTypes = ['films', 'reviews', 'lists'];
        for (const type of likeTypes) {
            try {
                const response = await fetch(`${basePath}/likes/${type}.csv`);
                if (response.ok) {
                    const text = await response.text();
                    this.data.likes[type] = this.parseCSV(text);
                }
            } catch (error) {
                console.warn(`Error loading likes/${type}.csv:`, error);
            }
        }
    }
    
    async loadLists(basePath = 'letterboxd-export') {
        try {
            // Get list files for current user from config, or fall back to common patterns
            let listFiles = [];
            
            if (this.currentUser && this.currentUser.lists) {
                listFiles = this.currentUser.lists;
            } else {
                // Fallback to common patterns for backward compatibility
                listFiles = [
                    '2019.csv',
                    'lapflix-2023-watchlist.csv',
                    'lapflix-movie-club.csv',
                    'the-tarantino-movies-ranked.csv'
                ];
            }
            
            for (const filename of listFiles) {
                try {
                    const response = await fetch(`${basePath}/lists/${filename}`);
                    if (response.ok) {
                        const text = await response.text();
                        const listData = this.parseListCSV(text);
                        if (listData) {
                            listData.filename = filename;
                            this.data.lists.push(listData);
                        }
                    }
                } catch (error) {
                    console.warn(`Could not load list ${filename}:`, error);
                }
            }
        } catch (error) {
            console.warn('Error loading lists:', error);
        }
    }
    
    parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return [];
        
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const data = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index];
                });
                data.push(row);
            }
        }
        
        return data;
    }
    
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    }
    
    parseListCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 6) return null;
        
        // Parse list metadata (lines 1-3)
        const metaHeaders = lines[1].split(',');
        const metaValues = this.parseCSVLine(lines[2]);
        const metadata = {};
        metaHeaders.forEach((header, index) => {
            metadata[header.trim()] = metaValues[index] || '';
        });
        
        // Parse list items (lines 5+)
        const itemHeaders = lines[4].split(',').map(h => h.trim());
        const items = [];
        
        for (let i = 5; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === itemHeaders.length) {
                const item = {};
                itemHeaders.forEach((header, index) => {
                    item[header] = values[index];
                });
                items.push(item);
            }
        }
        
        return {
            metadata,
            items
        };
    }
    
    processData() {
        // Update profile display
        const usernameElement = document.getElementById('username');
        const profileInfo = document.getElementById('profile-info');
        
        if (usernameElement) {
            if (this.data.profile && this.data.profile.Username) {
                usernameElement.textContent = this.data.profile.Username;
            } else if (this.currentUser.isSingleUserMode) {
                usernameElement.textContent = 'Letterboxd Viewer';
            } else {
                usernameElement.textContent = this.currentUser.displayName;
            }
        }
        
        // Update profile info styling based on mode
        if (profileInfo) {
            // Always allow opening the switcher to access Live Data toggle, even in single-user mode
            profileInfo.style.cursor = 'pointer';
            profileInfo.onclick = () => this.showUserSwitcher();
            const chevron = profileInfo.querySelector('.bi-chevron-down');
            if (chevron) {
                chevron.style.display = 'inline';
            }
        }
        
        // Process favorite films
        if (this.data.profile && this.data.profile['Favorite Films']) {
            const favoriteUrls = this.data.profile['Favorite Films'].split(', ');
            this.data.favoriteFilms = favoriteUrls.map(url => {
                // Find matching film data from watched/diary
                const film = this.findFilmByUrl(url);
                return film;
            }).filter(Boolean);
        }
        
        // Snapshot original CSV-only data needed for reverting live merges
        try {
            this._csvSnapshot = this._csvSnapshot || {};
            // Deep copy diary only (others remain unchanged by live merges)
            this._csvSnapshot.diary = JSON.parse(JSON.stringify(this.data.diary || []));
        } catch (e) {
            // Fallback shallow copy
            this._csvSnapshot = this._csvSnapshot || {};
            this._csvSnapshot.diary = (this.data.diary || []).map(x => ({ ...x }));
        }

        // Initialize RSS live data
        this.initializeLiveData();
    }
    
    // RSS Live Data Integration
    initializeLiveData() {
    // Prepare internal live data state and initialize RSS manager
    if (!this.currentUser) return;

    // Internal state: persist in-memory and optionally in localStorage per user
    if (this._liveDataState == null) this._liveDataState = {};
    const userKey = this.currentUser.id;
    const username = this.getLetterboxdUsername();
    const defaultEnabled = this.currentUser.enableLiveData === true;
    const stored = localStorage.getItem(`live_enabled_${userKey}`);
    const enabled = stored == null ? false : stored === 'true';
    this._liveDataState[userKey] = enabled;

    // Initialize RSS manager (enabled flag just gates availability; fetching is on toggle)
    window.letterboxdRSS.init(username, defaultEnabled);
    }

    async toggleLiveData(enabled) {
        // Persist per-user preference
        if (this.currentUser) {
            localStorage.setItem(`live_enabled_${this.currentUser.id}`, enabled ? 'true' : 'false');
            if (!this._liveDataState) this._liveDataState = {};
            this._liveDataState[this.currentUser.id] = enabled;
        }

        if (enabled) {
            console.log('Live data enabled - fetching RSS data...');
            
            // Show toast notification
            this.showToast('Enabling live data...', 'info');
            
            try {
                // Test RSS access first
                const hasAccess = await window.letterboxdRSS.testRSSAccess(this.getLetterboxdUsername());
                if (!hasAccess) {
                    throw new Error('RSS feed not accessible');
                }
                
                // Merge RSS data with existing data
                await this.mergeRSSData();
                
                this.showToast('Live data enabled! 📡', 'success');
            } catch (error) {
                console.error('Failed to enable live data:', error);
                this.showToast('Failed to enable live data: ' + error.message, 'error');
                
                // Reset UI toggles on error (modal toggle if present)
                const modalSwitch = document.getElementById('selectedUserLiveSwitch');
                if (modalSwitch) modalSwitch.checked = false;
            }
        } else {
            console.log('Live data disabled - reverting to CSV data');
            this.showToast('Live data disabled', 'info');
            // Restore original CSV-only diary data
            if (this._csvSnapshot && Array.isArray(this._csvSnapshot.diary)) {
                try {
                    this.data.diary = JSON.parse(JSON.stringify(this._csvSnapshot.diary));
                } catch (_) {
                    this.data.diary = (this._csvSnapshot.diary || []).map(x => ({ ...x }));
                }
            }
        }
        
    // Refresh current view
    if (this.currentSection === 'dashboard') {
            this.showDashboard();
        } else if (this.currentSection === 'diary') {
            this.renderDiary();
    } else if (this.currentSection === 'all-films' || this.currentSection === 'allFilms') {
            this.renderAllFilms();
        }
    }

    async mergeRSSData() {
        if (!window.letterboxdRSS || !window.letterboxdRSS.isLiveDataAvailable()) {
            return;
        }

        try {
            // Merge diary data with smart date filtering
            const originalDiaryLength = this.data.diary.length;
            this.data.diary = await window.letterboxdRSS.mergeWithDiaryData(this.data.diary);
            const newDiaryEntries = this.data.diary.length - originalDiaryLength;
            
            console.log(`RSS merge complete: +${newDiaryEntries} diary entries`);
            
            if (newDiaryEntries > 0) {
                this.showToast(`Added ${newDiaryEntries} new diary entries`, 'success');
            } else {
                this.showToast('No new entries found in RSS feed', 'info');
            }
            
        } catch (error) {
            console.error('Failed to merge RSS data:', error);
            throw error;
        }
    }
    
    findFilmByUrl(url) {
        // Search in diary first (has more metadata)
        let film = this.data.diary.find(entry => entry['Letterboxd URI'] === url);
        if (film) return film;
        
        // Then search in watched
        film = this.data.watched.find(entry => entry['Letterboxd URI'] === url);
        if (film) return film;
        
        // Finally search in ratings
        film = this.data.ratings.find(entry => entry['Letterboxd URI'] === url);
        return film;
    }
    
    formatStarRating(rating) {
        if (!rating) return '';
        
        const numericRating = parseFloat(rating);
        if (isNaN(numericRating)) return '';
        
        const fullStars = Math.floor(numericRating);
        const hasHalfStar = (numericRating % 1) >= 0.5;
        
        let starDisplay = '★'.repeat(fullStars);
        if (hasHalfStar) {
            starDisplay += '½';
        }
        
        return starDisplay;
    }
    
    async getTMDBData(filmName, year) {
        const cacheKey = `${filmName}_${year}`;
        
        if (this.tmdbCache.has(cacheKey)) {
            return this.tmdbCache.get(cacheKey);
        }
        
    if (!this.hasValidTMDBKey()) {
            // Handle missing API key case
            this.handleTMDBConnectivityError('no_api_key');
            
            return {
                poster_path: null,
                backdrop_path: null,
                overview: '',
                tmdb_id: null,
                error: 'no_api_key'
            };
        }
        
        try {
            // First try searching for movies
            const movieSearchUrl = `${this.TMDB_BASE_URL}/search/movie?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(filmName)}&year=${year}`;
            const movieResponse = await fetch(movieSearchUrl);
            
            if (!movieResponse.ok) {
                throw new Error(`HTTP ${movieResponse.status}: ${movieResponse.statusText}`);
            }
            
            const movieData = await movieResponse.json();
            const movie = movieData.results && movieData.results[0];
            
            if (movie) {
                const result = {
                    poster_path: movie.poster_path,
                    backdrop_path: movie.backdrop_path,
                    overview: movie.overview,
                    tmdb_id: movie.id,
                    media_type: 'movie'
                };
                
                this.tmdbCache.set(cacheKey, result);
                // Mark as online if we got a successful response
                this.tmdbConnectivity.isOnline = true;
                return result;
            }
            
            // If no movie found, try searching for TV shows
            const tvSearchUrl = `${this.TMDB_BASE_URL}/search/tv?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(filmName)}&first_air_date_year=${year}`;
            const tvResponse = await fetch(tvSearchUrl);
            
            if (!tvResponse.ok) {
                throw new Error(`HTTP ${tvResponse.status}: ${tvResponse.statusText}`);
            }
            
            const tvData = await tvResponse.json();
            const tvShow = tvData.results && tvData.results[0];
            
            if (tvShow) {
                const result = {
                    poster_path: tvShow.poster_path,
                    backdrop_path: tvShow.backdrop_path,
                    overview: tvShow.overview,
                    tmdb_id: tvShow.id,
                    media_type: 'tv'
                };
                
                this.tmdbCache.set(cacheKey, result);
                // Mark as online if we got a successful response
                this.tmdbConnectivity.isOnline = true;
                return result;
            }
            
            // No results found but connection successful
            this.tmdbConnectivity.isOnline = true;
            
        } catch (error) {
            console.warn(`Error fetching TMDB data for ${filmName}:`, error);
            
            // Handle different types of errors
            if (error.message.includes('HTTP 401')) {
                // Invalid API key
                this.handleTMDBConnectivityError('invalid_api_key');
            } else if (error.name === 'TypeError' || error.message.includes('Failed to fetch') || 
                       error.message.includes('Network') || error.message.includes('HTTP 5')) {
                // Network connectivity issues
                this.handleTMDBConnectivityError('connectivity');
            }
        }
        
        // Return empty data on error or no results
        const emptyResult = {
            poster_path: null,
            backdrop_path: null,
            overview: '',
            tmdb_id: null,
            error: this.tmdbConnectivity.isOnline ? 'no_results' : 'connectivity'
        };
        this.tmdbCache.set(cacheKey, emptyResult);
        return emptyResult;
    }
    
    createTMDBUrl(tmdbData, filmName, filmYear) {
        if (tmdbData.tmdb_id) {
            const mediaType = tmdbData.media_type || 'movie';
            return `https://www.themoviedb.org/${mediaType}/${tmdbData.tmdb_id}`;
        } else {
            // Fallback to TMDB search using only the title to maximize results
            return `https://www.themoviedb.org/search?query=${encodeURIComponent(filmName)}`;
        }
    }
    
    // Toast notification system
    showToast(message, type = 'info', duration = 5000) {
        console.log('showToast called:', message, type); // Debug log
        
        // Check if user has permanently dismissed TMDB errors
        if (type === 'tmdb-error' && localStorage.getItem('tmdb_errors_dismissed') === 'true') {
            return;
        }
        
        // Remove existing toast container if it exists
        const existingContainer = document.getElementById('toast-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        
        // Create toast container
        const toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '1055';
        
        // Create toast
        const toast = document.createElement('div');
        
        // Apply custom class for TMDB errors
        if (type === 'tmdb-error') {
            toast.className = 'toast toast-tmdb-error align-items-center border-0 show';
        } else {
            toast.className = `toast align-items-center text-bg-${type} border-0 show`;
        }
        
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        // Create appropriate content for TMDB errors vs regular toasts
        if (type === 'tmdb-error') {
            toast.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        ${message}
                    </div>
                    <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            `;
        } else {
            toast.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            `;
        }
        
        toastContainer.appendChild(toast);
        document.body.appendChild(toastContainer);
        
        console.log('Toast element created and added to DOM'); // Debug log
        
        // Add persistent dismissal for TMDB errors
        if (type === 'tmdb-error') {
            const closeButton = toast.querySelector('.btn-close');
            if (closeButton) {
                closeButton.addEventListener('click', () => {
                    localStorage.setItem('tmdb_errors_dismissed', 'true');
                    console.log('TMDB errors dismissed permanently');
                });
            }
        }
        
        // Auto-hide after duration
        setTimeout(() => {
            if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
                const bsToast = new bootstrap.Toast(toast);
                bsToast.hide();
            } else {
                // Fallback if Bootstrap JS isn't available
                toast.classList.remove('show');
                toast.classList.add('fade');
            }
            
            setTimeout(() => {
                if (toastContainer.parentNode) {
                    toastContainer.remove();
                }
            }, 500);
        }, duration);
    }
    
    // Generate consistent fallback poster for a film
    getFallbackPosterUrl(filmName, year) {
        const cacheKey = `${filmName}_${year}`;
        
        // Check if we already assigned a poster to this film
        if (this.posterIndexCache.has(cacheKey)) {
            return `img/${this.posterIndexCache.get(cacheKey).toString().padStart(2, '0')}.jpeg`;
        }
        
        // Generate a consistent index based on film name and year
        let hash = 0;
        const str = `${filmName}${year}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // Convert hash to index between 1 and fallbackPosterCount
        const index = Math.abs(hash % this.fallbackPosterCount) + 1;
        
        // Cache the assignment for consistency
        this.posterIndexCache.set(cacheKey, index);
        
        return `img/${index.toString().padStart(2, '0')}.jpeg`;
    }
    
    // Check and handle TMDB connectivity
    handleTMDBConnectivityError(errorType = 'connectivity') {
        const now = Date.now();
        
        // Check if user has permanently dismissed TMDB errors
        const dismissedKey = 'tmdb_errors_dismissed';
        if (localStorage.getItem(dismissedKey) === 'true') {
            return; // Don't show toast if user has dismissed it permanently
        }
        
        // Mark as offline
        this.tmdbConnectivity.isOnline = false;
        this.tmdbConnectivity.lastErrorTime = now;
        
        // Create appropriate message based on error type
        let message, toastType;
        
        if (errorType === 'no_api_key') {
            message = 'TMDB API key not configured. Using local poster images instead.';
            toastType = 'tmdb-error';
        } else if (errorType === 'invalid_api_key') {
            message = 'TMDB API key is invalid or unauthorized. Using local poster images instead.';
            toastType = 'tmdb-error';
        } else {
            message = 'Unable to connect to TMDB servers. Using local poster images instead.';
            toastType = 'tmdb-error';
        }
        
        // Show toast only once per session or after 30 minutes
        if (!this.tmdbConnectivity.hasShownOfflineToast || 
            (this.tmdbConnectivity.lastErrorTime && now - this.tmdbConnectivity.lastErrorTime > 30 * 60 * 1000)) {
            
            this.showToast(message, toastType, 3000);
            this.tmdbConnectivity.hasShownOfflineToast = true;
        }
    }
    
    // Generate poster URL with fallback handling
    getPosterUrl(tmdbData, filmName, year) {
        if (tmdbData.poster_path && this.tmdbConnectivity.isOnline) {
            return `${this.TMDB_IMAGE_BASE}${tmdbData.poster_path}`;
        } else {
            return this.getFallbackPosterUrl(filmName, year);
        }
    }
    
    hideLoading() {
        document.getElementById('loading-screen').classList.add('d-none');
    }
    
    showNavigation() {
        const navbar = document.getElementById('main-navbar');
        if (navbar) {
            navbar.classList.remove('d-none');
            document.body.classList.remove('navbar-hidden');
        }
    }
    
    showError(message) {
        this.hideLoading();
        document.getElementById('loading-screen').innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle"></i> ${message}
            </div>
        `;
        document.getElementById('loading-screen').classList.remove('d-none');
    }
    
    showSectionLoading(sectionId) {
        this.loadingStates[sectionId] = true;
        const loadingHtml = `
            <div class="text-center p-5 section-loading">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-3 text-muted">Loading movie posters...</p>
            </div>
        `;
        
        // Add loading indicator to the content container
        const contentContainerId = sectionId === 'allFilms' ? 'all-films-content' : `${sectionId}-content`;
        const container = document.getElementById(contentContainerId);
        if (container) {
            container.innerHTML = loadingHtml;
        }
    }
    
    hideSectionLoading(sectionId) {
        this.loadingStates[sectionId] = false;
        const contentContainerId = sectionId === 'allFilms' ? 'all-films-content' : `${sectionId}-content`;
        const container = document.getElementById(contentContainerId);
        if (container) {
            const loadingElement = container.querySelector('.section-loading');
            if (loadingElement) {
                loadingElement.remove();
            }
        }
    }
    
    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.add('d-none');
        });
        
        // Show selected section
        document.getElementById(sectionId).classList.remove('d-none');
        this.currentSection = sectionId;
        
        // Update navigation
        this.updateNavigation();
    }
    
    updateNavigation() {
        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        
        // Map section names to their corresponding nav functions
        const sectionNavMap = {
            'dashboard': 'showDashboard',
            'diary': 'showDiary',
            'all-films': 'showAllFilms',
            'watchlist': 'showWatchlist',
            'reviews': 'showReviews',
            'lists': 'showLists'
        };
        
        const navFunction = sectionNavMap[this.currentSection];
        if (navFunction) {
            const currentNavLink = document.querySelector(`[onclick="${navFunction}()"]`);
            if (currentNavLink) {
                currentNavLink.classList.add('active');
            }
        }
    }
    
    async showDashboard() {
        this.showSection('dashboard');
        await this.renderDashboard();
    }
    
    async renderDashboard() {
        // Update stats
        document.getElementById('total-watched').textContent = this.data.watched.length;
        document.getElementById('total-reviews').textContent = this.data.reviews.length;
        document.getElementById('total-watchlist').textContent = this.data.watchlist.length;
        
        // Render recent activity
        await this.renderRecentActivity();
        
        // Render favorite films
        await this.renderFavoriteFilms();
        
        // Create charts
        setTimeout(() => {
            this.createMonthlyChart();
            this.createRatingChart();
        }, 100);
    }
    
    async renderRecentActivity() {
        const recentContainer = document.getElementById('recent-activity');
        
    // Combine CSV diary data with live RSS data if enabled
    let diaryData = [...this.data.diary];
        
        // Check if live data is enabled
    const liveEnabled = this.isLiveEnabledForCurrentUser();
    if (liveEnabled && window.letterboxdRSS && window.letterboxdRSS.isLiveDataAvailable()) {
            try {
                const liveEntries = await window.letterboxdRSS.getRecentDiaryEntries(10);
                // Use smart merging to avoid duplicates and only show newer entries
                diaryData = this.mergeLiveDataWithCSV(this.data.diary, liveEntries, {
                    maxLiveEntries: 10,
                    onlyNewerThanLatest: true,
                    strictDuplicateCheck: true
                });
                console.log(`Recent activity: merged data now has ${diaryData.length} entries`);
            } catch (error) {
                console.warn('Failed to fetch live activity entries:', error);
            }
        }
        
        // Sort by date descending (newest first), then slice
        const recentEntries = [...diaryData]
            .sort((a, b) => new Date(b.Date || b.WatchedDate) - new Date(a.Date || a.WatchedDate))
            .slice(0, 5);
        
        if (recentEntries.length === 0) {
            recentContainer.innerHTML = '<p class="text-muted">No recent activity found.</p>';
            return;
        }
        
        let html = '';
        for (const entry of recentEntries) {
            const rating = this.formatStarRating(entry.Rating);
            const rewatch = entry.Rewatch === 'Yes' ? '<span class="badge bg-info">Rewatch</span>' : '';
            const isLiveData = entry.isLiveData === true;
            const liveBadge = isLiveData ? '<i class="bi bi-rss text-success ms-1" title="Live Data"></i>' : '';
            const watchDate = entry.Date || entry.WatchedDate;
            
            html += `
                <div class="activity-item">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <strong class="activity-title">${entry.Name}</strong> <span class="activity-year">(${entry.Year})</span>${liveBadge}
                            <div class="activity-meta">
                                ${rating && `<span class="star-rating">${rating}</span>`}
                                ${rewatch}
                                ${entry.Tags ? `<span class="tag">${entry.Tags}</span>` : ''}
                            </div>
                        </div>
                        <small class="activity-date">${watchDate ? new Date(watchDate).toLocaleDateString() : 'Recently'}</small>
                    </div>
                </div>
            `;
        }
        
        // Add "View More" link if there are more entries
        const totalEntries = diaryData.length;
        if (totalEntries > 5) {
            html += `
                <div class="text-center mt-3">
                    <a href="#" onclick="app.showDiary()" class="btn btn-outline-primary btn-sm">
                        View All Activity (${totalEntries} total)
                    </a>
                </div>
            `;
        }
        
        recentContainer.innerHTML = html;
    }
    
    async renderFavoriteFilms() {
        const container = document.getElementById('favorite-films');
        
        if (!this.data.favoriteFilms || this.data.favoriteFilms.length === 0) {
            container.innerHTML = '<p class="text-muted">No favorite films found.</p>';
            return;
        }
        
        // Show loading indicator for favorite films
        container.innerHTML = `
            <div class="text-center p-3">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 mb-0 small text-muted">Loading favorite films...</p>
            </div>
        `;
        
        let html = '';
        for (const film of this.data.favoriteFilms) {
            const tmdbData = await this.getTMDBData(film.Name, film.Year);
            const posterUrl = this.getPosterUrl(tmdbData, film.Name, film.Year);
            
            // Create TMDB URL
            const tmdbUrl = this.createTMDBUrl(tmdbData, film.Name, film.Year);
            
            html += `
                <div class="favorite-film" 
                     data-bs-toggle="tooltip" 
                     data-bs-placement="bottom" 
                     title="${film.Name} (${film.Year})">
                    <img src="${posterUrl}" 
                         alt="${film.Name}" 
                         class="img-fluid"
                         style="cursor: pointer;"
                         onclick="window.open('${tmdbUrl}', '_blank')">
                    <div class="favorite-film-title">${film.Name}</div>
                    <div class="favorite-film-year">${film.Year}</div>
                </div>
            `;
        }
        
        container.innerHTML = html;
        
        // Initialize Bootstrap tooltips for favorite films
        const tooltipTriggerList = container.querySelectorAll('[data-bs-toggle="tooltip"]');
        const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }
    
    async showDiary() {
        this.showSection('diary');
        await this.renderDiary();
    }
    
    async renderDiary() {
        const container = document.getElementById('diary-content');
        const paginationContainer = document.getElementById('diary-pagination');
        
        // Show loading indicator
        if (this.hasValidTMDBKey()) {
            this.showSectionLoading('diary');
        }
        
    // Combine CSV diary data with live RSS data if enabled
    let diaryData = [...this.data.diary];
        
        // Check if live data is enabled
    const liveEnabled = this.isLiveEnabledForCurrentUser();
    if (liveEnabled && window.letterboxdRSS && window.letterboxdRSS.isLiveDataAvailable()) {
            try {
                const liveEntries = await window.letterboxdRSS.getRecentDiaryEntries(50); // More entries for diary view
                // Use smart merging to avoid duplicates and only show newer entries
                diaryData = this.mergeLiveDataWithCSV(this.data.diary, liveEntries, {
                    maxLiveEntries: 50,
                    onlyNewerThanLatest: true,
                    strictDuplicateCheck: true
                });
                console.log(`Diary view: merged data now has ${diaryData.length} entries`);
            } catch (error) {
                console.warn('Failed to fetch live diary entries:', error);
            }
        }
        
        if (diaryData.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted">No diary entries found.</p></div>';
            paginationContainer.innerHTML = '';
            this.hideSectionLoading('diary');
            return;
        }
        
        const sortedData = this.sortData(diaryData, this.pagination.diary);
        const paginatedData = this.paginateData(sortedData, this.pagination.diary);
        
        let html = '';
        for (const entry of paginatedData) {
            html += await this.createMovieCard(entry, true);
        }
        
        // Hide loading and show content
    this.hideSectionLoading('diary');
        container.innerHTML = html;
        paginationContainer.innerHTML = this.createPagination('diary', sortedData.length);
    }
    
    sortData(data, paginationConfig) {
        const [sortBy, sortOrder] = paginationConfig.sortBy.includes('-') 
            ? paginationConfig.sortBy.split('-') 
            : [paginationConfig.sortBy, paginationConfig.sortOrder];
        
        return [...data].sort((a, b) => {
            let valueA, valueB;
            
            switch (sortBy) {
                case 'date':
                case 'watch':
                    valueA = new Date(a.Date || a['Watched Date'] || '1900-01-01');
                    valueB = new Date(b.Date || b['Watched Date'] || '1900-01-01');
                    break;
                case 'name':
                    valueA = (a.Name || '').toLowerCase();
                    valueB = (b.Name || '').toLowerCase();
                    break;
                case 'year':
                    valueA = parseInt(a.Year || '0');
                    valueB = parseInt(b.Year || '0');
                    break;
                case 'rating':
                    // Only compare films that have ratings, put unrated films at the end
                    valueA = a.Rating ? parseFloat(a.Rating) : -1;
                    valueB = b.Rating ? parseFloat(b.Rating) : -1;
                    break;
                default:
                    valueA = new Date(a.Date || a['Watched Date'] || '1900-01-01');
                    valueB = new Date(b.Date || b['Watched Date'] || '1900-01-01');
            }
            
            if (sortOrder === 'desc') {
                return valueB > valueA ? 1 : valueB < valueA ? -1 : 0;
            } else {
                return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
            }
        });
    }
    
    paginateData(data, paginationConfig) {
        const startIndex = (paginationConfig.page - 1) * paginationConfig.limit;
        const endIndex = startIndex + paginationConfig.limit;
        return data.slice(startIndex, endIndex);
    }
    
    createPagination(section, totalItems) {
        const config = this.pagination[section];
        const totalPages = Math.ceil(totalItems / config.limit);
        
        if (totalPages <= 1) return '';
        
        let html = '<nav><ul class="pagination justify-content-center">';
        
        // Previous button
        if (config.page > 1) {
            html += `<li class="page-item">
                <a class="page-link" href="#" onclick="app.changePage('${section}', ${config.page - 1})">Previous</a>
            </li>`;
        }
        
        // Page numbers
        const startPage = Math.max(1, config.page - 2);
        const endPage = Math.min(totalPages, config.page + 2);
        
        if (startPage > 1) {
            html += `<li class="page-item">
                <a class="page-link" href="#" onclick="app.changePage('${section}', 1)">1</a>
            </li>`;
            if (startPage > 2) {
                html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === config.page ? 'active' : '';
            html += `<li class="page-item ${isActive}">
                <a class="page-link" href="#" onclick="app.changePage('${section}', ${i})">${i}</a>
            </li>`;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
            html += `<li class="page-item">
                <a class="page-link" href="#" onclick="app.changePage('${section}', ${totalPages})">${totalPages}</a>
            </li>`;
        }
        
        // Next button
        if (config.page < totalPages) {
            html += `<li class="page-item">
                <a class="page-link" href="#" onclick="app.changePage('${section}', ${config.page + 1})">Next</a>
            </li>`;
        }
        
        html += '</ul></nav>';
        
        // Add item count
        const startItem = (config.page - 1) * config.limit + 1;
        const endItem = Math.min(config.page * config.limit, totalItems);
        html += `<small class="text-muted">Showing ${startItem}-${endItem} of ${totalItems} items</small>`;
        
        return html;
    }
    
    async changePage(section, page) {
        this.pagination[section].page = page;
        
        switch (section) {
            case 'diary':
                await this.renderDiary();
                break;
            case 'watchlist':
                await this.renderWatchlist();
                break;
            case 'reviews':
                await this.renderReviews();
                break;
            case 'allFilms':
                await this.renderAllFilms();
                break;
        }
        
        // Scroll to top of section
        document.getElementById(section === 'allFilms' ? 'all-films' : section).scrollIntoView({ behavior: 'smooth' });
    }
    
    async changeDiarySort(sortValue) {
        this.pagination.diary.sortBy = sortValue;
        this.pagination.diary.page = 1;
        await this.renderDiary();
    }
    
    async changeWatchlistSort(sortValue) {
        this.pagination.watchlist.sortBy = sortValue;
        this.pagination.watchlist.page = 1;
        await this.renderWatchlist();
    }
    
    async changeReviewsSort(sortValue) {
        this.pagination.reviews.sortBy = sortValue;
        this.pagination.reviews.page = 1;
        await this.renderReviews();
    }
    
    async changeAllFilmsSort(sortValue) {
        this.pagination.allFilms.sortBy = sortValue;
        this.pagination.allFilms.page = 1;
        await this.renderAllFilms();
    }
    
    async changeAllFilmsRatingFilter(filterValue) {
        this.pagination.allFilms.ratingFilter = filterValue;
        this.pagination.allFilms.page = 1;
        await this.renderAllFilms();
    }
    
    async showAllFilms() {
        this.showSection('all-films');
        await this.renderAllFilms();
    }
    
    async renderAllFilms() {
        const container = document.getElementById('all-films-content');
        const paginationContainer = document.getElementById('all-films-pagination');
        
        // Add live data banner only when live data is enabled
    const liveEnabled = this.isLiveEnabledForCurrentUser() && window.letterboxdRSS && window.letterboxdRSS.isLiveDataAvailable();
        if (liveEnabled) {
            // Watched page does not include live data; show explanatory banner only when live data is ON
            this.showLiveDataBanner('all-films', false);
        } else {
            // Ensure banner is removed when live data is OFF
            const existingBanner = document.querySelector('#all-films .live-data-banner');
            if (existingBanner) existingBanner.remove();
        }
        
        // Use watched data as the primary source for "All Films" - this contains all films marked as watched
        if (this.data.watched.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted">No watched films found. Mark some films as watched on Letterboxd to see them here.</p></div>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Show loading indicator (skip if no valid TMDB key)
        if (this.hasValidTMDBKey()) {
            this.showSectionLoading('allFilms');
        }
        
        // Use watched data - these are all films marked as watched
        // Merge rating data from diary and ratings before sorting
        let filmsData = this.data.watched.map(entry => {
            // Look for rating data from diary first, then ratings
            const diaryEntry = this.data.diary.find(d => d.Name === entry.Name && d.Year === entry.Year);
            const ratingEntry = this.data.ratings.find(r => r.Name === entry.Name && r.Year === entry.Year);
            
            return {
                ...entry,
                source: 'watched',
                watchDate: entry['Watched Date'] || entry.Date,
                // Add rating from diary first, then ratings, then original
                Rating: diaryEntry?.Rating || ratingEntry?.Rating || entry.Rating
            };
        });
        
        // Apply rating filter if specified
        if (this.pagination.allFilms.ratingFilter) {
            filmsData = this.filterFilmsByRating(filmsData, this.pagination.allFilms.ratingFilter);
        }
        
        const sortedData = this.sortAllFilmsData(filmsData, this.pagination.allFilms);
        const paginatedData = this.paginateData(sortedData, this.pagination.allFilms);
        
        let html = '';
        for (const film of paginatedData) {
            // Check if this film also has diary entry for additional info
            const diaryEntry = this.data.diary.find(d => d.Name === film.Name && d.Year === film.Year);
            const filmWithDiaryInfo = diaryEntry ? { ...film, ...diaryEntry } : film;
            html += await this.createMovieCard(filmWithDiaryInfo, !!diaryEntry); // Show diary info only if it exists
        }
        
    // Hide loading and show content
    this.hideSectionLoading('allFilms');
        container.innerHTML = html;
        paginationContainer.innerHTML = this.createPagination('allFilms', sortedData.length);
    }
    
    sortAllFilmsData(data, paginationConfig) {
        const [sortBy, sortOrder] = paginationConfig.sortBy.includes('-') 
            ? paginationConfig.sortBy.split('-') 
            : [paginationConfig.sortBy, paginationConfig.sortOrder];
        
        return [...data].sort((a, b) => {
            let valueA, valueB;
            
            switch (sortBy) {
                case 'watch':
                case 'date':
                    // Use watchDate first, then fall back to Date
                    valueA = new Date(a.watchDate || a.Date || '1900-01-01');
                    valueB = new Date(b.watchDate || b.Date || '1900-01-01');
                    break;
                case 'name':
                    valueA = (a.Name || '').toLowerCase();
                    valueB = (b.Name || '').toLowerCase();
                    break;
                case 'year':
                    valueA = parseInt(a.Year || '0');
                    valueB = parseInt(b.Year || '0');
                    break;
                case 'rating':
                    // Only compare films that have ratings, put unrated films at the end
                    valueA = a.Rating ? parseFloat(a.Rating) : -1;
                    valueB = b.Rating ? parseFloat(b.Rating) : -1;
                    break;
                default:
                    // Default to year for watched films
                    valueA = parseInt(a.Year || '0');
                    valueB = parseInt(b.Year || '0');
            }
            
            if (sortOrder === 'desc') {
                return valueB > valueA ? 1 : valueB < valueA ? -1 : 0;
            } else {
                return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
            }
        });
    }
    
    filterFilmsByRating(data, ratingFilter) {
        if (!ratingFilter) return data;
        
        return data.filter(film => {
            if (ratingFilter === 'no-rating') {
                // Show films with no rating
                return !film.Rating || film.Rating === '' || film.Rating === '0';
            } else {
                // Show films with specific rating
                const filmRating = parseFloat(film.Rating);
                const filterRating = parseFloat(ratingFilter);
                return filmRating === filterRating;
            }
        });
    }
    
    async showWatchlist() {
        this.showSection('watchlist');
        await this.renderWatchlist();
    }
    
    async renderWatchlist() {
        const container = document.getElementById('watchlist-content');
        const paginationContainer = document.getElementById('watchlist-pagination');
        
        if (this.data.watchlist.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted">No watchlist items found.</p></div>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Show loading indicator (skip if no valid TMDB key)
        if (this.hasValidTMDBKey()) {
            this.showSectionLoading('watchlist');
        }
        
        const sortedData = this.sortData(this.data.watchlist, this.pagination.watchlist);
        const paginatedData = this.paginateData(sortedData, this.pagination.watchlist);
        
        let html = '';
        for (const item of paginatedData) {
            html += await this.createMovieCard(item, false);
        }
        
    // Hide loading and show content
    this.hideSectionLoading('watchlist');
        container.innerHTML = html;
        paginationContainer.innerHTML = this.createPagination('watchlist', sortedData.length);
    }
    
    async createMovieCard(film, showDiaryInfo = false) {
        const tmdbData = await this.getTMDBData(film.Name, film.Year);
        const posterUrl = this.getPosterUrl(tmdbData, film.Name, film.Year);
        
        // Create TMDB URL
        const tmdbUrl = this.createTMDBUrl(tmdbData, film.Name, film.Year);
        
        const rating = this.formatStarRating(film.Rating);
        const rewatch = film.Rewatch === 'Yes' ? '<span class="badge bg-info">Rewatch</span>' : '';
        const tags = film.Tags ? film.Tags.split(',').map(tag => `<span class="tag">${tag.trim()}</span>`).join('') : '';
        const isLiveData = film.isLiveData === true;
        const liveBadge = isLiveData ? '<span class="badge bg-success ms-1"><i class="bi bi-rss"></i> Live</span>' : '';
        
        return `
            <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
                <div class="card movie-card" onclick="window.open('${tmdbUrl}', '_blank')">
                    <div class="movie-poster-container">
                        <img src="${posterUrl}" class="movie-poster" alt="${film.Name}" loading="lazy">
                        ${isLiveData ? '<div class="live-data-indicator"><i class="bi bi-rss"></i></div>' : ''}
                    </div>
                    <div class="card-body">
                        <h6 class="movie-title">${film.Name}${liveBadge}</h6>
                        <p class="movie-year mb-2">${film.Year}</p>
                        ${showDiaryInfo ? `
                            <div class="movie-meta">
                                ${rating && `<div class="star-rating mb-1">${rating}</div>`}
                                ${rewatch}
                                ${tags}
                                ${film.Date || film.WatchedDate ? `<small class="text-muted d-block mt-2">Watched: ${new Date(film.Date || film.WatchedDate).toLocaleDateString()}</small>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }
    
    async showReviews() {
        this.showSection('reviews');
        await this.renderReviews();
    }
    
    async renderReviews() {
        const container = document.getElementById('reviews-content');
        const paginationContainer = document.getElementById('reviews-pagination');
        
        if (this.data.reviews.length === 0) {
            container.innerHTML = '<p class="text-muted">No reviews found.</p>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Filter reviews that actually have review text
        const reviewsWithText = this.data.reviews.filter(review => review.Review && review.Review.trim());
        
        if (reviewsWithText.length === 0) {
            container.innerHTML = '<p class="text-muted">No written reviews found.</p>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Show loading indicator (skip if no valid TMDB key)
        if (this.hasValidTMDBKey()) {
            this.showSectionLoading('reviews');
        }
        
        const sortedData = this.sortData(reviewsWithText, this.pagination.reviews);
        const paginatedData = this.paginateData(sortedData, this.pagination.reviews);
        
        let html = '';
        for (const review of paginatedData) {
            html += await this.createReviewCard(review);
        }
        
    // Hide loading and show content
    this.hideSectionLoading('reviews');
        container.innerHTML = html;
        paginationContainer.innerHTML = this.createPagination('reviews', sortedData.length);
    }
    
    async createReviewCard(review) {
        const tmdbData = await this.getTMDBData(review.Name, review.Year);
        const posterUrl = this.getPosterUrl(tmdbData, review.Name, review.Year);
        
        // Create TMDB URL
        const tmdbUrl = this.createTMDBUrl(tmdbData, review.Name, review.Year);
        
        const rating = this.formatStarRating(review.Rating);
        
        return `
            <div class="card review-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-2 text-center">
                            <img src="${posterUrl}" 
                                 class="img-fluid rounded" 
                                 style="max-width: 100px; cursor: pointer;" 
                                 alt="${review.Name}"
                                 onclick="window.open('${tmdbUrl}', '_blank')">
                        </div>
                        <div class="col-md-10">
                            <h5 class="card-title">
                                <a href="${tmdbUrl}" target="_blank" class="text-decoration-none">
                                    ${review.Name} (${review.Year})
                                </a>
                            </h5>
                            ${rating && `<div class="star-rating mb-2">${rating}</div>`}
                            <p class="review-content">${review.Review}</p>
                            <div class="review-meta">
                                <small class="text-muted">
                                    Reviewed on ${new Date(review.Date).toLocaleDateString()}
                                    ${review.Tags ? ` • Tagged: ${review.Tags}` : ''}
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    async showLists() {
        this.showSection('lists');
        await this.renderLists();
    }
    
    async renderLists() {
        const container = document.getElementById('lists-content');
        
        if (this.data.lists.length === 0) {
            container.innerHTML = '<p class="text-muted">No lists found.</p>';
            return;
        }
        
        let html = '';
        for (const list of this.data.lists) {
            html += this.createListCard(list);
        }
        
        container.innerHTML = html;
    }
    
    createListCard(list) {
        const listName = list.metadata.Name || list.filename.replace('.csv', '');
        const description = list.metadata.Description || '';
        const itemCount = list.items.length;
        
        return `
            <div class="card list-card mb-4">
                <div class="card-body">
                    <h5 class="list-title">${listName}</h5>
                    ${description && `<p class="text-muted">${description}</p>`}
                    <p class="mb-2"><strong>${itemCount}</strong> films</p>
                    <button class="btn btn-outline-primary btn-sm" onclick="app.showListDetails('${list.filename}')">
                        View List
                    </button>
                </div>
            </div>
        `;
    }
    
    async showListDetails(filename) {
        const list = this.data.lists.find(l => l.filename === filename);
        if (!list) return;
        
        // Create a modal to display the list
        const existingModal = document.getElementById('listDetailsModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const listName = list.metadata.Name || list.filename.replace('.csv', '');
        const description = list.metadata.Description || '';
        
        let html = `
            <div class="modal fade" id="listDetailsModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <div>
                                <h5 class="modal-title mb-1">
                                    <i class="bi bi-list-ul"></i> ${listName}
                                </h5>
                                ${description ? `<p class="text-muted mb-0 small">${description}</p>` : ''}
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <span class="text-muted">${list.items.length} films</span>
                                <div id="listLoadingIndicator" class="d-none">
                                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                    <span class="ms-2 small text-muted">Loading posters...</span>
                                </div>
                            </div>
                            <div class="row" id="listMoviesContainer">
                                <!-- Movies will be loaded here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', html);
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('listDetailsModal'));
        modal.show();
        
        // Load movie details
        await this.renderListMovies(list);
        
        // Clean up when modal is hidden
        document.getElementById('listDetailsModal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }
    
    async renderListMovies(list) {
        const container = document.getElementById('listMoviesContainer');
        const loadingIndicator = document.getElementById('listLoadingIndicator');
        
        if (!container) return;
        
        // Show loading indicator
        if (loadingIndicator) {
            loadingIndicator.classList.remove('d-none');
        }
        
        let html = '';
        
        for (const item of list.items) {
            // Create a movie card for each list item
            html += await this.createListMovieCard(item);
        }
        
        // Hide loading indicator
        if (loadingIndicator) {
            loadingIndicator.classList.add('d-none');
        }
        
        container.innerHTML = html;
    }
    
    async createListMovieCard(listItem) {
        // List items might have different field names than diary entries
        const movieName = listItem.Name || listItem['Film Name'] || listItem.Title;
        const movieYear = listItem.Year || listItem['Release Year'];
        const position = listItem.Position || '';
        const notes = listItem.Notes || listItem.Description || '';
        
        if (!movieName) {
            return ''; // Skip items without a name
        }
        
        const tmdbData = await this.getTMDBData(movieName, movieYear);
        const posterUrl = this.getPosterUrl(tmdbData, movieName, movieYear);
        
        // Create TMDB URL
        const tmdbUrl = this.createTMDBUrl(tmdbData, movieName, movieYear);
        
        return `
            <div class="col-lg-2 col-md-3 col-sm-4 col-6 mb-4">
                <div class="card movie-card h-100" onclick="window.open('${tmdbUrl}', '_blank')">
                    <div class="movie-poster-container">
                        <img src="${posterUrl}" class="movie-poster" alt="${movieName}" loading="lazy">
                        ${position ? `<span class="position-badge">#${position}</span>` : ''}
                    </div>
                    <div class="card-body p-2">
                        <h6 class="movie-title small mb-1" title="${movieName}">${movieName}</h6>
                        <p class="movie-year small mb-1">${movieYear || 'Unknown'}</p>
                        ${notes ? `<p class="list-notes small text-muted mb-0" title="${notes}">${notes.length > 50 ? notes.substring(0, 50) + '...' : notes}</p>` : ''}
                    </div>
                </div>
            </div>
        `;
    }
    
    createMonthlyChart(range = this.monthlyChartRange) {
        const canvas = document.getElementById('monthlyChart');
        if (!canvas) return;
        
        // Destroy existing chart if it exists
        if (this.monthlyChart) {
            this.monthlyChart.destroy();
        }
        
        // Process diary data by month
        const monthlyData = {};
        this.data.diary.forEach(entry => {
            if (entry.Date) {
                const date = new Date(entry.Date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
            }
        });
        
        // Sort months and apply range filter
        const allSortedMonths = Object.keys(monthlyData).sort();
        const sortedMonths = range === '12months' ? allSortedMonths.slice(-12) : allSortedMonths;
        
        const labels = sortedMonths.map(month => {
            const [year, monthNum] = month.split('-');
            const date = new Date(year, monthNum - 1);
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        const data = sortedMonths.map(month => monthlyData[month] || 0);
        
        const ctx = canvas.getContext('2d');
        this.monthlyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Films Watched',
                    data: data,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    tension: 0.1,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    createRatingChart() {
        const canvas = document.getElementById('ratingChart');
        if (!canvas) return;
        
        // Destroy existing chart if it exists
        if (this.ratingChart) {
            this.ratingChart.destroy();
        }
        
        // Process rating distribution
        const ratingCounts = {
            '0.5': 0, '1.0': 0, '1.5': 0, '2.0': 0, '2.5': 0,
            '3.0': 0, '3.5': 0, '4.0': 0, '4.5': 0, '5.0': 0
        };
        
        let totalRating = 0;
        let ratingCount = 0;
        
        this.data.ratings.forEach(entry => {
            if (entry.Rating) {
                const rating = parseFloat(entry.Rating);
                const ratingKey = rating.toFixed(1);
                if (ratingCounts.hasOwnProperty(ratingKey)) {
                    ratingCounts[ratingKey]++;
                    totalRating += rating;
                    ratingCount++;
                }
            }
        });
        
        // Calculate and display average rating
        const averageRating = ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : '0.0';
        const averageElement = document.getElementById('average-rating');
        if (averageElement) {
            averageElement.textContent = `${averageRating} ★`;
        }
        
        const labels = Object.keys(ratingCounts).map(rating => `${rating} ★`);
        const data = Object.values(ratingCounts);
        
        const ctx = canvas.getContext('2d');
        this.ratingChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Number of Films',
                    data: data,
                    backgroundColor: [
                        '#00ac52', '#00ac52', '#00ac52', '#00ac52', '#00ac52',
                        '#00ac52', '#00ac52', '#00ac52', '#00ac52', '#00ac52'
                    ],
                    hoverBackgroundColor: [
                        '#ff8000', '#ff8000', '#ff8000', '#ff8000', '#ff8000',
                        '#ff8000', '#ff8000', '#ff8000', '#ff8000', '#ff8000'
                    ]
                }]
            },
            options: {
                responsive: true,
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const ratings = ['0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0'];
                        const selectedRating = ratings[index];
                        this.filterWatchedByRating(selectedRating);
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    filterWatchedByRating(rating) {
        // Set the rating filter
        this.pagination.allFilms.ratingFilter = rating;
        this.pagination.allFilms.page = 1;
        
        // Navigate to watched films section
        this.showAllFilms();
        
        // Update the filter dropdown to reflect the selection
        const filterDropdown = document.querySelector('#all-films select[onchange="app.changeAllFilmsRatingFilter(this.value)"]');
        if (filterDropdown) {
            filterDropdown.value = rating;
        }
    }
    
    setMonthlyChartRange(range) {
        this.monthlyChartRange = range;
        
        // Update button states
        const btn12 = document.getElementById('monthly-12-btn');
        const btnAll = document.getElementById('monthly-all-btn');
        
        if (range === '12months') {
            btn12.classList.add('active');
            btnAll.classList.remove('active');
        } else {
            btn12.classList.remove('active');
            btnAll.classList.add('active');
        }
        
        // Recreate the chart with new range
        this.createMonthlyChart(range);
    }
    
    showUserSwitcher() {
    // Always allow the switcher, even for single-user mode (to expose Live Data toggle)
        
        // Create a modal or dropdown for user switching
        const existingModal = document.getElementById('userSwitcherModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        let html = `
            <div class="modal fade" id="userSwitcherModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-person-circle"></i> Switch User
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted mb-3">Select a different Letterboxd export to view:</p>
        `;
        
    for (const user of this.users) {
            const isActive = user.id === this.currentUser.id;
            const lastUpdated = user.lastUpdated ? new Date(user.lastUpdated).toLocaleDateString() : 'Unknown';
            if (isActive) {
                // Selected user: show live toggle on the right with label above the switch
                const enabled = this.isLiveEnabledForCurrentUser();
                html += `
                    <div class="btn btn-success user-select-btn mb-2 w-100" style="cursor: default;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="text-start">
                                <div>
                                    <i class="bi bi-person"></i> ${user.displayName}
                                    <i class="bi bi-check-circle-fill ms-2"></i>
                                </div>
                                <small class="text-muted">Last updated: ${lastUpdated}</small>
                            </div>
                            <div class="live-toggle-container ms-3 text-end" title="Live Data" style="pointer-events: auto;">
                                <div class="live-toggle-label">Live Data <i class="bi bi-rss"></i></div>
                                <div class="form-check form-switch justify-content-end d-flex mt-1">
                                    <input class="form-check-input" type="checkbox" id="selectedUserLiveSwitch" ${enabled ? 'checked' : ''}>
                                    <label class="form-check-label visually-hidden" for="selectedUserLiveSwitch">Live Data</label>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else if (this.users.length > 1) {
                html += `
                    <button class="btn btn-outline-primary user-select-btn mb-2 w-100" 
                            onclick="app.switchToUser('${user.id}')">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="text-start">
                                <div>
                                    <i class="bi bi-person"></i> ${user.displayName}
                                </div>
                                <small class="text-muted">Last updated: ${lastUpdated}</small>
                            </div>
                            <i class="bi bi-chevron-right"></i>
                        </div>
                    </button>
                `;
            }
        }
        
        html += `
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', html);
        
        // Show modal
        const modalEl = document.getElementById('userSwitcherModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Hook up selected user live toggle
        const selectedLiveSwitch = document.getElementById('selectedUserLiveSwitch');
        if (selectedLiveSwitch) {
            selectedLiveSwitch.addEventListener('change', () => {
                this.toggleLiveData(selectedLiveSwitch.checked);
            });
        }
        
        // Clean up when modal is hidden
    document.getElementById('userSwitcherModal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }
    
    async switchToUser(userId) {
        if (userId === this.currentUser.id) {
            return; // Already viewing this user
        }
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('userSwitcherModal'));
        if (modal) {
            modal.hide();
        }
        
        // Show loading state
        const loadingHtml = `
            <div class="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center" 
                 style="background: rgba(0,0,0,0.8); z-index: 9999;">
                <div class="text-center text-white">
                    <div class="spinner-border mb-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <h5>Switching to ${this.users.find(u => u.id === userId)?.displayName || 'user'}...</h5>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', loadingHtml);
        
        try {
            await this.selectUser(userId);
            
            // Remove loading overlay
            const loadingOverlay = document.querySelector('.position-fixed[style*="z-index: 9999"]');
            if (loadingOverlay) {
                loadingOverlay.remove();
            }
        } catch (error) {
            console.error('Error switching user:', error);
            // Remove loading overlay
            const loadingOverlay = document.querySelector('.position-fixed[style*="z-index: 9999"]');
            if (loadingOverlay) {
                loadingOverlay.remove();
            }
        }
    }
    
    // Smart Live Data Merging Functions
    
    /**
     * Merge live RSS data with CSV data, avoiding duplicates intelligently
     */
    mergeLiveDataWithCSV(csvData, liveData, options = {}) {
        if (!liveData || liveData.length === 0) {
            return csvData;
        }
        
        const { 
            maxLiveEntries = 20, 
            onlyNewerThanLatest = true,
            strictDuplicateCheck = true 
        } = options;
        
        console.log(`Merging ${csvData.length} CSV entries with ${liveData.length} live entries`);
        
        // Find the latest date in CSV data
        let latestCSVDate = null;
        if (onlyNewerThanLatest && csvData.length > 0) {
            const dates = csvData
                .map(entry => entry.Date || entry.WatchedDate || entry['Watched Date'])
                .filter(date => date)
                .map(date => new Date(date))
                .filter(date => !isNaN(date));
            
            if (dates.length > 0) {
                latestCSVDate = new Date(Math.max(...dates));
                console.log('Latest CSV date found:', latestCSVDate.toISOString().split('T')[0]);
            }
        }
        
        // Filter live data to only include entries newer than latest CSV entry
        let filteredLiveData = liveData;
        if (latestCSVDate) {
            filteredLiveData = liveData.filter(entry => {
                const entryDate = new Date(entry.WatchedDate || entry.Date);
                return entryDate > latestCSVDate;
            });
            console.log(`Filtered to ${filteredLiveData.length} live entries newer than ${latestCSVDate.toISOString().split('T')[0]}`);
        }
        
        // If no new live entries, return original CSV data
        if (filteredLiveData.length === 0) {
            console.log('No new live entries to merge');
            return csvData;
        }
        
        // Limit the number of live entries
        filteredLiveData = filteredLiveData.slice(0, maxLiveEntries);
        
        // Smart duplicate detection
        const processedLiveData = this.removeDuplicates(csvData, filteredLiveData, strictDuplicateCheck);
        
        console.log(`Final merge: ${processedLiveData.length} new live entries added`);
        
        // Merge and sort by date (newest first)
        const mergedData = [...processedLiveData, ...csvData];
        return mergedData.sort((a, b) => {
            const dateA = new Date(a.Date || a.WatchedDate || a['Watched Date']);
            const dateB = new Date(b.Date || b.WatchedDate || b['Watched Date']);
            return dateB - dateA;
        });
    }
    
    /**
     * Remove duplicates using multiple detection strategies
     */
    removeDuplicates(csvData, liveData, strictCheck = true) {
        if (!strictCheck) {
            // Simple URI-based deduplication (original method)
            const existingUrls = new Set(csvData.map(entry => entry['Letterboxd URI'] || entry.LetterboxdURI));
            return liveData.filter(entry => !existingUrls.has(entry.LetterboxdURI || entry['Letterboxd URI']));
        }
        
        // Advanced duplicate detection using multiple criteria
        const duplicateKeys = new Set();
        
        // Build keys for existing CSV data
        csvData.forEach(entry => {
            const keys = this.generateDuplicateKeys(entry);
            keys.forEach(key => duplicateKeys.add(key));
        });
        
        // Filter live data against these keys
        return liveData.filter(entry => {
            const keys = this.generateDuplicateKeys(entry);
            return !keys.some(key => duplicateKeys.has(key));
        });
    }
    
    /**
     * Generate multiple keys for duplicate detection
     */
    generateDuplicateKeys(entry) {
        const keys = [];
        
        const title = (entry.Name || entry.title || '').trim().toLowerCase();
        const year = entry.Year || entry.year;
        const date = entry.Date || entry.WatchedDate || entry['Watched Date'];
        const uri = entry['Letterboxd URI'] || entry.LetterboxdURI;
        
        // Key 1: URI (if available)
        if (uri) {
            keys.push(`uri:${uri}`);
        }
        
        // Key 2: Title + Year
        if (title && year) {
            keys.push(`title_year:${title}|${year}`);
        }
        
        // Key 3: Title + Date (for same-day watches)
        if (title && date) {
            keys.push(`title_date:${title}|${date}`);
        }
        
        // Key 4: Title only (loose matching)
        if (title) {
            keys.push(`title:${title}`);
        }
        
        return keys;
    }

    // Live data banner system
    showLiveDataBanner(sectionId, hasLiveData) {
        // Remove existing banner if it exists
        const existingBanner = document.querySelector(`#${sectionId} .live-data-banner`);
        if (existingBanner) {
            existingBanner.remove();
        }
        
        // Find the section content container
        const sectionElement = document.getElementById(sectionId);
        if (!sectionElement) return;
        
        // Find the first content container within the section
        const contentContainer = sectionElement.querySelector('.container-fluid, .container, .row') || sectionElement;
        
        // Create banner
        const banner = document.createElement('div');
        banner.className = 'live-data-banner alert alert-' + (hasLiveData ? 'success' : 'warning') + ' mb-3';
        banner.style.marginTop = '10px';
        
        const icon = hasLiveData ? '📡' : '⚠️';
        const message = hasLiveData 
            ? 'This section includes live data from your Letterboxd RSS feed'
            : 'This section does not include live data - only your exported CSV data is shown';
        
        banner.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="me-2">${icon}</span>
                <span>${message}</span>
            </div>
        `;
        
        // Insert banner at the top of the content container
        contentContainer.insertBefore(banner, contentContainer.firstChild);
    }

    // ...existing code...
}

// Global functions for navigation
function collapseMobileNav() {
    // Check if we're on mobile and the navbar is expanded
    const navbar = document.getElementById('navbarNav');
    const navbarToggler = document.querySelector('.navbar-toggler');
    
    if (navbar && navbarToggler && !navbarToggler.classList.contains('collapsed')) {
        // Use Bootstrap's collapse functionality to close the navbar
        const bsCollapse = new bootstrap.Collapse(navbar, {
            toggle: false
        });
        bsCollapse.hide();
    }
}

function showDashboard() { 
    collapseMobileNav();
    app.showDashboard(); 
}
function showDiary() { 
    collapseMobileNav();
    app.showDiary(); 
}
function showAllFilms() { 
    collapseMobileNav();
    app.showAllFilms(); 
}
function showWatchlist() { 
    collapseMobileNav();
    app.showWatchlist(); 
}
function showReviews() { 
    collapseMobileNav();
    app.showReviews(); 
}
function showLists() { 
    collapseMobileNav();
    app.showLists(); 
}
function showUserSwitcher() { app.showUserSwitcher(); }



// Initialize the application
const app = new LetterboxdViewer();
window.viewer = app; // Make accessible to RSS functions

// Start the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
