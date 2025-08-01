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
        
        // Loading state management
        this.loadingStates = {
            dashboard: false,
            diary: false,
            allFilms: false,
            watchlist: false,
            reviews: false,
            lists: false,
            stats: false
        };
        
        // Pagination and sorting state
        this.pagination = {
            diary: { page: 1, limit: 32, sortBy: 'date-desc', sortOrder: 'desc' },
            watchlist: { page: 1, limit: 32, sortBy: 'date-desc', sortOrder: 'desc' },
            reviews: { page: 1, limit: 10, sortBy: 'date-desc', sortOrder: 'desc' },
            watched: { page: 1, limit: 32, sortBy: 'year-desc', sortOrder: 'desc' },
            allFilms: { page: 1, limit: 32, sortBy: 'year-desc', sortOrder: 'desc' }
        };
        
        this.init();
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
            if (this.currentUser.isSingleUserMode || this.users.length <= 1) {
                // In single user mode, make it non-clickable
                profileInfo.style.cursor = 'default';
                profileInfo.onclick = null;
                // Hide the dropdown chevron
                const chevron = profileInfo.querySelector('.bi-chevron-down');
                if (chevron) {
                    chevron.style.display = 'none';
                }
            } else {
                // In multi-user mode, make it clickable
                profileInfo.style.cursor = 'pointer';
                profileInfo.onclick = () => this.showUserSwitcher();
                // Show the dropdown chevron
                const chevron = profileInfo.querySelector('.bi-chevron-down');
                if (chevron) {
                    chevron.style.display = 'inline';
                }
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
        
        if (!this.TMDB_API_KEY || this.TMDB_API_KEY === 'YOUR_TMDB_API_KEY') {
            // Return placeholder data if no API key
            return {
                poster_path: null,
                backdrop_path: null,
                overview: '',
                tmdb_id: null
            };
        }
        
        try {
            // First try searching for movies
            const movieSearchUrl = `${this.TMDB_BASE_URL}/search/movie?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(filmName)}&year=${year}`;
            const movieResponse = await fetch(movieSearchUrl);
            
            if (movieResponse.ok) {
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
                    return result;
                }
            }
            
            // If no movie found, try searching for TV shows
            const tvSearchUrl = `${this.TMDB_BASE_URL}/search/tv?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(filmName)}&first_air_date_year=${year}`;
            const tvResponse = await fetch(tvSearchUrl);
            
            if (tvResponse.ok) {
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
                    return result;
                }
            }
        } catch (error) {
            console.warn(`Error fetching TMDB data for ${filmName}:`, error);
        }
        
        // Return empty data on error
        const emptyResult = {
            poster_path: null,
            backdrop_path: null,
            overview: '',
            tmdb_id: null
        };
        this.tmdbCache.set(cacheKey, emptyResult);
        return emptyResult;
    }
    
    createTMDBUrl(tmdbData, filmName, filmYear) {
        if (tmdbData.tmdb_id) {
            const mediaType = tmdbData.media_type || 'movie';
            return `https://www.themoviedb.org/${mediaType}/${tmdbData.tmdb_id}`;
        } else {
            return `https://www.themoviedb.org/search?query=${encodeURIComponent(filmName + ' ' + filmYear)}`;
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
            'lists': 'showLists',
            'stats': 'showStats'
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
        
        // Calculate average rating
        const ratingsWithValues = this.data.ratings.filter(r => r.Rating && !isNaN(parseFloat(r.Rating)));
        const avgRating = ratingsWithValues.length > 0 
            ? (ratingsWithValues.reduce((sum, r) => sum + parseFloat(r.Rating), 0) / ratingsWithValues.length).toFixed(1)
            : '0';
        document.getElementById('average-rating').textContent = avgRating;
        
        // Render recent activity
        await this.renderRecentActivity();
        
        // Render favorite films
        await this.renderFavoriteFilms();
    }
    
    async renderRecentActivity() {
        const recentContainer = document.getElementById('recent-activity');
        // Sort by date descending (newest first), then slice
        const recentEntries = [...this.data.diary]
            .sort((a, b) => new Date(b.Date) - new Date(a.Date))
            .slice(0, 10);
        
        if (recentEntries.length === 0) {
            recentContainer.innerHTML = '<p class="text-muted">No recent activity found.</p>';
            return;
        }
        
        let html = '';
        for (const entry of recentEntries) {
            const rating = this.formatStarRating(entry.Rating);
            const rewatch = entry.Rewatch === 'Yes' ? '<span class="badge bg-info">Rewatch</span>' : '';
            
            html += `
                <div class="activity-item">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <strong class="activity-title">${entry.Name}</strong> <span class="activity-year">(${entry.Year})</span>
                            <div class="activity-meta">
                                ${rating && `<span class="star-rating">${rating}</span>`}
                                ${rewatch}
                                ${entry.Tags ? `<span class="tag">${entry.Tags}</span>` : ''}
                            </div>
                        </div>
                        <small class="activity-date">${new Date(entry.Date).toLocaleDateString()}</small>
                    </div>
                </div>
            `;
        }
        
        // Add "View More" link if there are more entries
        if (this.data.diary.length > 10) {
            html += `
                <div class="text-center mt-3">
                    <a href="#" onclick="app.showDiary()" class="btn btn-outline-primary btn-sm">
                        View All Activity (${this.data.diary.length} total)
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
            const posterUrl = tmdbData.poster_path 
                ? `${this.TMDB_IMAGE_BASE}${tmdbData.poster_path}`
                : 'https://via.placeholder.com/80x120?text=No+Poster';
            
            // Create TMDB URL
            const tmdbUrl = this.createTMDBUrl(tmdbData, film.Name, film.Year);
            
            html += `
                <div class="favorite-film">
                    <img src="${posterUrl}" 
                         alt="${film.Name}" 
                         class="img-fluid"
                         style="cursor: pointer;"
                         onclick="window.open('${tmdbUrl}', '_blank')"
                         title="${film.Name} (${film.Year})">
                    <div class="favorite-film-title">${film.Name}</div>
                    <div class="favorite-film-year">${film.Year}</div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }
    
    async showDiary() {
        this.showSection('diary');
        await this.renderDiary();
    }
    
    async renderDiary() {
        const container = document.getElementById('diary-content');
        const paginationContainer = document.getElementById('diary-pagination');
        
        if (this.data.diary.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted">No diary entries found.</p></div>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Show loading indicator
        this.showSectionLoading('diary');
        
        const sortedData = this.sortData(this.data.diary, this.pagination.diary);
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
    
    async showAllFilms() {
        this.showSection('all-films');
        await this.renderAllFilms();
    }
    
    async renderAllFilms() {
        const container = document.getElementById('all-films-content');
        const paginationContainer = document.getElementById('all-films-pagination');
        
        // Use watched data as the primary source for "All Films" - this contains all films marked as watched
        if (this.data.watched.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted">No watched films found. Mark some films as watched on Letterboxd to see them here.</p></div>';
            paginationContainer.innerHTML = '';
            return;
        }
        
        // Show loading indicator
        this.showSectionLoading('allFilms');
        
        // Use watched data - these are all films marked as watched
        const filmsData = this.data.watched.map(entry => ({
            ...entry,
            source: 'watched',
            watchDate: entry['Watched Date'] || entry.Date
        }));
        
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
        
        // Show loading indicator
        this.showSectionLoading('watchlist');
        
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
        const posterUrl = tmdbData.poster_path 
            ? `${this.TMDB_IMAGE_BASE}${tmdbData.poster_path}`
            : 'https://via.placeholder.com/300x450?text=No+Poster';
        
        // Create TMDB URL
        const tmdbUrl = this.createTMDBUrl(tmdbData, film.Name, film.Year);
        
        const rating = this.formatStarRating(film.Rating);
        const rewatch = film.Rewatch === 'Yes' ? '<span class="badge bg-info">Rewatch</span>' : '';
        const tags = film.Tags ? film.Tags.split(',').map(tag => `<span class="tag">${tag.trim()}</span>`).join('') : '';
        
        return `
            <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
                <div class="card movie-card" onclick="window.open('${tmdbUrl}', '_blank')">
                    <div class="movie-poster-container">
                        <img src="${posterUrl}" class="movie-poster" alt="${film.Name}" loading="lazy">
                    </div>
                    <div class="card-body">
                        <h6 class="movie-title">${film.Name}</h6>
                        <p class="movie-year mb-2">${film.Year}</p>
                        ${showDiaryInfo ? `
                            <div class="movie-meta">
                                ${rating && `<div class="star-rating mb-1">${rating}</div>`}
                                ${rewatch}
                                ${tags}
                                ${film.Date ? `<small class="text-muted d-block mt-2">Watched: ${new Date(film.Date).toLocaleDateString()}</small>` : ''}
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
        
        // Show loading indicator
        this.showSectionLoading('reviews');
        
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
        const posterUrl = tmdbData.poster_path 
            ? `${this.TMDB_IMAGE_BASE}${tmdbData.poster_path}`
            : 'https://via.placeholder.com/100x150?text=No+Poster';
        
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
        const posterUrl = tmdbData.poster_path 
            ? `${this.TMDB_IMAGE_BASE}${tmdbData.poster_path}`
            : 'https://via.placeholder.com/300x450?text=No+Poster';
        
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
    
    async showStats() {
        this.showSection('stats');
        await this.renderStats();
    }
    
    async renderStats() {
        const container = document.getElementById('stats-content');
        
        if (this.data.diary.length === 0 && this.data.ratings.length === 0) {
            container.innerHTML = '<p class="text-muted">No data available for statistics.</p>';
            return;
        }
        
        // Create the stats layout
        let html = `
            <div class="row">
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-header">
                            <h5><i class="bi bi-calendar3"></i> Monthly Viewing Activity</h5>
                        </div>
                        <div class="card-body">
                            <canvas id="monthlyChart" width="400" height="200"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-header">
                            <h5><i class="bi bi-star"></i> Rating Distribution</h5>
                        </div>
                        <div class="card-body">
                            <canvas id="ratingChart" width="400" height="200"></canvas>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="row mt-4">
                <div class="col-md-3">
                    <div class="card text-center">
                        <div class="card-body">
                            <h3 class="text-primary">${this.data.diary.length}</h3>
                            <p class="card-text">Films Logged</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card text-center">
                        <div class="card-body">
                            <h3 class="text-success">${this.data.reviews.filter(r => r.Review && r.Review.trim()).length}</h3>
                            <p class="card-text">Reviews Written</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card text-center">
                        <div class="card-body">
                            <h3 class="text-warning">${this.data.watchlist.length}</h3>
                            <p class="card-text">Films to Watch</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card text-center">
                        <div class="card-body">
                            <h3 class="text-info">${this.calculateAverageRating()}</h3>
                            <p class="card-text">Average Rating</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Create charts after DOM is updated
        setTimeout(() => {
            this.createMonthlyChart();
            this.createRatingChart();
        }, 100);
    }
    
    calculateAverageRating() {
        const ratingsWithValues = this.data.ratings.filter(r => r.Rating && !isNaN(parseFloat(r.Rating)));
        if (ratingsWithValues.length === 0) return '0.0';
        
        const average = ratingsWithValues.reduce((sum, r) => sum + parseFloat(r.Rating), 0) / ratingsWithValues.length;
        return average.toFixed(1);
    }
    
    createMonthlyChart() {
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
        
        // Sort months and get last 12 months
        const sortedMonths = Object.keys(monthlyData).sort().slice(-12);
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
        
        this.data.ratings.forEach(entry => {
            if (entry.Rating) {
                const rating = parseFloat(entry.Rating).toFixed(1);
                if (ratingCounts.hasOwnProperty(rating)) {
                    ratingCounts[rating]++;
                }
            }
        });
        
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
                    ]
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
    
    showUserSwitcher() {
        // Don't show switcher in single user mode or if only one user
        if (this.users.length <= 1 || (this.currentUser && this.currentUser.isSingleUserMode)) {
            return;
        }
        
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
            html += `
                <button class="btn ${isActive ? 'btn-primary' : 'btn-outline-primary'} user-switch-btn mb-2 w-100" 
                        onclick="app.switchToUser('${user.id}')"
                        ${isActive ? 'disabled' : ''}>
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="text-start">
                            <div>
                                <i class="bi bi-person"></i> ${user.displayName}
                                ${isActive ? '<i class="bi bi-check-circle-fill ms-2"></i>' : ''}
                            </div>
                            <small class="text-muted">Last updated: ${lastUpdated}</small>
                        </div>
                        ${!isActive ? '<i class="bi bi-chevron-right"></i>' : ''}
                    </div>
                </button>
            `;
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
        const modal = new bootstrap.Modal(document.getElementById('userSwitcherModal'));
        modal.show();
        
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
    
    // ...existing code...
}

// Global functions for navigation
function showDashboard() { app.showDashboard(); }
function showDiary() { app.showDiary(); }
function showAllFilms() { app.showAllFilms(); }
function showWatchlist() { app.showWatchlist(); }
function showReviews() { app.showReviews(); }
function showLists() { app.showLists(); }
function showStats() { app.showStats(); }
function showUserSwitcher() { app.showUserSwitcher(); }

// Initialize the app when the page loads
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new LetterboxdViewer();
});
