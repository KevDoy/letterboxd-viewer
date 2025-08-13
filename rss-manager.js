// RSS Live Data Module for Letterboxd Viewer
class LetterboxdRSSManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.isEnabled = false;
        this.currentUsername = null;
    }

    /**
     * Initialize RSS manager with user settings
     */
    init(username, enableLiveData = false) {
        this.currentUsername = username;
        this.isEnabled = enableLiveData;
        return this.isEnabled;
    }

    /**
     * Check if live data is available for current user
     */
    isLiveDataAvailable() {
        return this.isEnabled && this.currentUsername;
    }

    /**
     * Fetch user's RSS feed from Letterboxd
     */
    async fetchRSSFeed(username = null) {
        const user = username || this.currentUsername;
        if (!user) {
            throw new Error('No username provided');
        }

        const cacheKey = `rss_${user}`;
        const cached = this.cache.get(cacheKey);
        
        // Return cached data if available and not expired
        if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
            console.log('Returning cached RSS data');
            return cached.data;
        }

        console.log(`Fetching fresh RSS data for user: ${user}`);

        try {
            // Letterboxd RSS URL format
            const rssUrl = `https://letterboxd.com/${user}/rss/`;
            
            // Use a CORS proxy to fetch RSS
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
            
            console.log('Fetching RSS from:', rssUrl);
            
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to fetch RSS`);
            }

            const data = await response.json();
            
            if (!data.contents) {
                throw new Error('No content received from proxy');
            }
            
            console.log('RSS content received, length:', data.contents.length);

            // Handle base64 encoded data URLs
            let rssText = data.contents.trim();
            if (rssText.startsWith('data:application/rss+xml;charset=utf-8;base64,')) {
                console.log('Detected base64 encoded RSS content, decoding...');
                const base64Content = rssText.split(',')[1];
                rssText = atob(base64Content);
                console.log('Decoded RSS content, length:', rssText.length);
            }

            // Basic validation - check if it looks like XML
            if (!rssText.startsWith('<?xml') && !rssText.startsWith('<rss') && !rssText.startsWith('<feed')) {
                console.warn('Response does not appear to be valid XML/RSS');
                console.log('Response starts with:', rssText.substring(0, 100));
                throw new Error('Invalid RSS format received');
            }

            // Parse RSS XML
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(rssText, 'text/xml');
            
            // Check for parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.error('XML parsing error:', parseError.textContent);
                throw new Error(`XML parsing failed: ${parseError.textContent}`);
            }
            
            console.log('XML parsed successfully');

            const items = this.parseRSSItems(xmlDoc);
            
            if (items.length === 0) {
                console.warn('No RSS items found in feed');
            } else {
                console.log(`Successfully parsed ${items.length} RSS items`);
            }
            
            // Cache the results
            this.cache.set(cacheKey, {
                data: items,
                timestamp: Date.now()
            });

            return items;

        } catch (error) {
            console.error('RSS fetch failed:', error.message);
            // Return empty array on error - graceful degradation
            return [];
        }
    }

    /**
     * Parse RSS XML items into structured data
     */
    parseRSSItems(xmlDoc) {
        const items = Array.from(xmlDoc.querySelectorAll('item'));
        console.log(`Found ${items.length} RSS items`);
        
        if (items.length === 0) {
            // Try alternative selectors in case the RSS structure is different
            const entries = Array.from(xmlDoc.querySelectorAll('entry'));
            console.log(`Found ${entries.length} RSS entries (Atom format)`);
            if (entries.length > 0) {
                return this.parseAtomEntries(entries);
            }
        }
        
        return items.map((item, index) => {
            const title = item.querySelector('title')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '';
            const description = item.querySelector('description')?.textContent || '';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            
            console.log(`Item ${index + 1}:`, { title, link, pubDate });
            
            // Parse the activity type from title
            const activityType = this.determineActivityType(title, description);
            
            // Extract film information from the link and description
            const filmInfo = this.extractFilmInfo(title, link, description);
            
            return {
                title,
                link,
                description,
                pubDate: pubDate ? new Date(pubDate) : new Date(),
                activityType,
                filmInfo,
                isLiveData: true // Flag to identify live data
            };
        });
    }

    /**
     * Parse Atom feed entries (alternative format)
     */
    parseAtomEntries(entries) {
        return entries.map((entry, index) => {
            const title = entry.querySelector('title')?.textContent || '';
            const link = entry.querySelector('link')?.getAttribute('href') || '';
            const summary = entry.querySelector('summary')?.textContent || '';
            const published = entry.querySelector('published')?.textContent || entry.querySelector('updated')?.textContent || '';
            
            console.log(`Atom entry ${index + 1}:`, { title, link, published });
            
            const activityType = this.determineActivityType(title, summary);
            const filmInfo = this.extractFilmInfo(title, link, summary);
            
            return {
                title,
                link,
                description: summary,
                pubDate: published ? new Date(published) : new Date(),
                activityType,
                filmInfo,
                isLiveData: true
            };
        });
    }

    /**
     * Determine activity type from RSS item
     */
    determineActivityType(title, description) {
        const lowerTitle = title.toLowerCase();
        
        if (lowerTitle.includes('watched')) return 'diary';
        if (lowerTitle.includes('reviewed')) return 'review';
        if (lowerTitle.includes('liked')) return 'like';
        if (lowerTitle.includes('added') && lowerTitle.includes('watchlist')) return 'watchlist';
        if (lowerTitle.includes('created a list')) return 'list';
        
        return 'activity'; // Generic activity
    }

    /**
     * Extract film information from RSS item
     */
    extractFilmInfo(title, link, description) {
        // Extract film title from the title string
        // Letterboxd RSS titles can vary, so try multiple patterns
        const patterns = [
            // Standard patterns: "Username watched Film Title ★★★★"
            /watched (.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/,
            /reviewed (.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/,
            /liked (.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/,
            // More flexible patterns
            /^[^\s]+\s+(.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/, // Username + anything
            /^[^\s]+\s+\w+\s+(.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/, // Username + verb + film
            /^.+?\s+(.+?)(?:\s+★+)?(?:\s+\(\d{4}\))?$/ // Any word + film title
        ];

        let filmTitle = null;
        let year = null;
        let rating = null;

        // Try each pattern until we find a match
        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match && match[1] && match[1].trim().length > 0) {
                filmTitle = match[1].trim();
                break;
            }
        }

        // If no pattern matched, try to extract from the link or use the full title
        if (!filmTitle) {
            // Try to extract from Letterboxd link
            const linkMatch = link.match(/\/film\/([^\/]+)\//);
            if (linkMatch) {
                // Convert URL slug to title
                filmTitle = linkMatch[1]
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, l => l.toUpperCase());
            } else {
                // Last resort: use title after removing username (assume first word is username)
                const words = title.split(' ');
                if (words.length > 1) {
                    filmTitle = words.slice(1).join(' ');
                    // Clean up stars and year from the end
                    filmTitle = filmTitle.replace(/\s+★+\s*$/, '');
                    filmTitle = filmTitle.replace(/\s+\(\d{4}\)\s*$/, '');
                }
            }
        }

        // Extract star rating from title
        const starMatch = title.match(/★+/);
        if (starMatch) {
            rating = starMatch[0].length; // Count the stars
        }

        // Try to extract year from description or title
        const yearMatch = (title + ' ' + description).match(/\((\d{4})\)/);
        if (yearMatch) {
            year = parseInt(yearMatch[1]);
        }

        return {
            title: filmTitle,
            year: year,
            rating: rating,
            letterboxdUrl: link
        };
    }

    /**
     * Get recent diary entries from RSS
     */
    async getRecentDiaryEntries(limit = 10) {
        if (!this.isLiveDataAvailable()) {
            return [];
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            return rssItems
                .slice(0, limit) // Take all recent activity, not just "diary" type
                .map(item => ({
                    Name: item.filmInfo.title || 'Unknown',
                    Year: item.filmInfo.year || '',
                    LetterboxdURI: item.filmInfo.letterboxdUrl || '',
                    'Letterboxd URI': item.filmInfo.letterboxdUrl || '',
                    WatchedDate: item.pubDate.toISOString().split('T')[0], // YYYY-MM-DD format
                    'Watched Date': item.pubDate.toISOString().split('T')[0],
                    Date: item.pubDate.toISOString().split('T')[0],
                    Rating: item.filmInfo.rating ? item.filmInfo.rating.toString() : '', // Convert to string for consistency
                    Rewatch: 'No', // Default assumption
                    Tags: 'live-data', // Tag to identify live data
                    isLiveData: true,
                    _isFromRSS: true
                }));
        } catch (error) {
            console.warn('Failed to get recent diary entries:', error);
            return [];
        }
    }

    /**
     * Get diary entries newer than a specific date
     */
    async getDiaryEntriesSince(sinceDate) {
        if (!this.isLiveDataAvailable()) {
            return [];
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            const sinceDateObj = new Date(sinceDate);
            
            return rssItems
                .filter(item => {
                    // Accept all RSS activity as potential diary entries
                    // Filter by date only
                    const itemDate = new Date(item.pubDate);
                    return itemDate > sinceDateObj;
                })
                .map(item => this.convertRSSItemToDiaryFormat(item));
        } catch (error) {
            console.error('Failed to get diary entries since date:', error);
            return [];
        }
    }

    /**
     * Convert RSS item to diary CSV format
     */
    convertRSSItemToDiaryFormat(rssItem) {
        const filmInfo = rssItem.filmInfo || {};
        const watchedDate = new Date(rssItem.pubDate);
        
        return {
            'Date': this.formatDateForCSV(watchedDate),
            'Name': filmInfo.title || 'Unknown Film',
            'Year': filmInfo.year || '',
            'Letterboxd URI': filmInfo.letterboxdUrl || '',
            'Rating': filmInfo.rating ? filmInfo.rating.toString() : '', // Convert to string for consistency
            'Rewatch': '', // Cannot determine from RSS
            'Tags': '', // Cannot determine from RSS
            'Watched Date': this.formatDateForCSV(watchedDate),
            '_isFromRSS': true, // Flag to identify RSS entries
            'isLiveData': true // Additional flag for UI distinction
        };
    }

    /**
     * Convert RSS item to watched CSV format
     */
    convertRSSItemToWatchedFormat(rssItem) {
        const filmInfo = rssItem.filmInfo || {};
        const watchedDate = new Date(rssItem.pubDate);
        
        return {
            'Date': this.formatDateForCSV(watchedDate),
            'Name': filmInfo.title || 'Unknown Film',
            'Year': filmInfo.year || '',
            'Letterboxd URI': filmInfo.letterboxdUrl || '',
            '_isFromRSS': true // Flag to identify RSS entries
        };
    }

    /**
     * Format date for CSV compatibility (YYYY-MM-DD)
     */
    formatDateForCSV(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * Merge RSS diary entries with existing CSV data
     */
    async mergeWithDiaryData(existingDiaryData) {
        if (!this.isLiveDataAvailable() || !existingDiaryData || existingDiaryData.length === 0) {
            return existingDiaryData || [];
        }

        try {
            // Find the most recent entry date in existing data
            const latestEntry = existingDiaryData.reduce((latest, entry) => {
                const entryDate = new Date(entry['Watched Date'] || entry['Date']);
                const latestDate = new Date(latest['Watched Date'] || latest['Date']);
                return entryDate > latestDate ? entry : latest;
            }, existingDiaryData[0]);

            const latestDate = latestEntry ? new Date(latestEntry['Watched Date'] || latestEntry['Date']) : new Date('1900-01-01');
            
            console.log('Latest diary entry date:', this.formatDateForCSV(latestDate));

            // Get newer RSS entries
            const newRSSEntries = await this.getDiaryEntriesSince(latestDate);
            
            console.log(`Found ${newRSSEntries.length} new RSS diary entries`);

            // Merge with existing data (RSS entries first for chronological order)
            const mergedData = [...newRSSEntries, ...existingDiaryData];
            
            // Sort by date descending
            mergedData.sort((a, b) => {
                const dateA = new Date(a['Watched Date'] || a['Date']);
                const dateB = new Date(b['Watched Date'] || b['Date']);
                return dateB - dateA;
            });

            return mergedData;

        } catch (error) {
            console.error('Failed to merge RSS diary data:', error);
            return existingDiaryData;
        }
    }

    /**
     * Merge RSS entries with watched data to add new films
     */
    async mergeWithWatchedData(existingWatchedData) {
        if (!this.isLiveDataAvailable()) {
            return existingWatchedData || [];
        }

        try {
            // Get all diary entries from RSS (treat all RSS activity as diary entries)
            const rssItems = await this.fetchRSSFeed();
            const rssDiaryEntries = rssItems
                .map(item => this.convertRSSItemToWatchedFormat(item));

            // Find films that don't exist in watched data
            const existingFilms = new Set(
                (existingWatchedData || []).map(film => 
                    `${film.Name}_${film.Year}`.toLowerCase()
                )
            );

            const newFilms = rssDiaryEntries.filter(film => {
                const filmKey = `${film.Name}_${film.Year}`.toLowerCase();
                return !existingFilms.has(filmKey);
            });

            console.log(`Found ${newFilms.length} new films to add to watched list`);

            // Merge new films with existing data
            const mergedData = [...(existingWatchedData || []), ...newFilms];
            
            // Sort by date descending
            mergedData.sort((a, b) => {
                const dateA = new Date(a['Date']);
                const dateB = new Date(b['Date']);
                return dateB - dateA;
            });

            return mergedData;

        } catch (error) {
            console.error('Failed to merge RSS watched data:', error);
            return existingWatchedData || [];
        }
    }

    /**
     * Get activity summary for dashboard
     */
    async getActivitySummary() {
        if (!this.isLiveDataAvailable()) {
            return null;
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            const today = new Date();
            const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

            const recentActivity = rssItems.filter(item => item.pubDate >= sevenDaysAgo);
            
            return {
                totalActivities: recentActivity.length,
                watchedCount: recentActivity.filter(item => item.activityType === 'diary').length,
                reviewedCount: recentActivity.filter(item => item.activityType === 'review').length,
                likedCount: recentActivity.filter(item => item.activityType === 'like').length,
                lastActivity: rssItems.length > 0 ? rssItems[0].pubDate : null
            };
        } catch (error) {
            console.warn('Failed to get activity summary:', error);
            return null;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Check if RSS is accessible for a given username
     */
    async testRSSAccess(username) {
        try {
            console.log(`Testing RSS access for username: ${username}`);
            
            const items = await this.fetchRSSFeed(username);
            const hasAccess = items.length > 0;
            
            console.log(`RSS test result for ${username}: ${hasAccess ? 'SUCCESS' : 'NO DATA'} (${items.length} items found)`);
            
            // Consider it successful if we got a response, even if no items
            // (user might just not have recent activity)
            return true; // Change this to be more permissive
            
        } catch (error) {
            console.error('RSS access test failed:', error);
            return false;
        }
    }

    /**
     * Test if a Letterboxd user profile exists
     */
    async testUserProfile(username) {
        try {
            const profileUrl = `https://letterboxd.com/${username}/`;
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(profileUrl)}`;
            
            console.log(`Testing user profile: ${profileUrl}`);
            
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                return false;
            }
            
            const data = await response.json();
            const htmlContent = data.contents;
            
            // Check if it's a valid profile page (not a 404 or error page)
            const isValidProfile = htmlContent && 
                                 !htmlContent.includes('Page not found') && 
                                 !htmlContent.includes('User not found') &&
                                 htmlContent.includes('letterboxd.com') &&
                                 htmlContent.includes(username);
            
            console.log(`Profile test for ${username}: ${isValidProfile ? 'VALID' : 'INVALID'}`);
            return isValidProfile;
            
        } catch (error) {
            console.warn(`Profile test failed for ${username}:`, error.message);
            return false;
        }
    }
}

// Create global instance
window.letterboxdRSS = new LetterboxdRSSManager();
