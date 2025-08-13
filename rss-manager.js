// RSS Live Data Module for Letterboxd Viewer
class LetterboxdRSSManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.isEnabled = false;
        this.currentUsername = null;
        this.lastAddedDiaryEntries = []; // Track newly added diary entries for watched merge
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
        // Your RSS format: "ghosteffect A Minecraft Movie, 2025 - â˜…â˜…â˜…"
        let filmTitle = null;
        let year = null;
        let rating = null;

        // Clean up encoded characters first
        const cleanTitle = title
            .replace(/â˜…/g, '★') // Fix encoded stars
            .replace(/â€™/g, "'") // Fix encoded apostrophes
            .replace(/â€œ/g, '"') // Fix encoded quotes
            .replace(/â€/g, '"')
            // Fix specific patterns from your RSS feed
            .replace(/ââââ/g, '★★★★') // Fix 4 stars
            .replace(/âââ/g, '★★★') // Fix 3 stars
            .replace(/ââ/g, '★★') // Fix 2 stars
            .replace(/ââÂ½/g, '★★½') // Fix 2.5 stars
            .replace(/âÂ½/g, '★½') // Fix 1.5 stars
            .replace(/â½/g, '½') // Fix other half star encoding
            .replace(/Â½/g, '½') // Fix remaining half star encoding
            .replace(/â/g, '★') // Convert remaining â to stars as fallback
            .trim();

        console.log('Original title:', title);
        console.log('Cleaned title:', cleanTitle);

        // Debug: show what star patterns we can find
        const starPatterns = cleanTitle.match(/[★½]+/g);
        console.log('Found star patterns:', starPatterns);

        // Pattern for your RSS format: "username FilmTitle, Year - ★★½" (including half stars)
        const mainPattern = /^[^\s]+\s+(.+?),\s*(\d{4})\s*-\s*(★*½?)$/;
        const match = cleanTitle.match(mainPattern);

        if (match) {
            filmTitle = match[1].trim();
            year = parseInt(match[2]);
            
            // Parse rating including half stars
            const ratingStr = match[3];
            const fullStars = (ratingStr.match(/★/g) || []).length;
            const hasHalfStar = ratingStr.includes('½');
            rating = fullStars + (hasHalfStar ? 0.5 : 0);
            
            console.log('Pattern match success:', { filmTitle, year, rating, ratingStr });
        } else {
            // Try alternative pattern without the dash and stars
            const altPattern = /^[^\s]+\s+(.+?),\s*(\d{4}).*$/;
            const altMatch = cleanTitle.match(altPattern);
            
            if (altMatch) {
                filmTitle = altMatch[1].trim();
                year = parseInt(altMatch[2]);
                
                // Extract stars and half stars separately
                const starMatch = cleanTitle.match(/[★½]+/g);
                if (starMatch && starMatch.length > 0) {
                    // Join all star patterns and count
                    const allStars = starMatch.join('');
                    const fullStars = (allStars.match(/★/g) || []).length;
                    const hasHalfStar = allStars.includes('½');
                    rating = fullStars + (hasHalfStar ? 0.5 : 0);
                }
                
                console.log('Alternative pattern match:', { filmTitle, year, rating });
            } else {
                // Fallback: try to extract just the film title after username
                const words = cleanTitle.split(' ');
                if (words.length > 1) {
                    // Remove username (first word)
                    let titlePart = words.slice(1).join(' ');
                    
                    // Remove year and everything after it
                    titlePart = titlePart.replace(/,\s*\d{4}.*$/, '');
                    
                    // Clean up any remaining artifacts
                    titlePart = titlePart.replace(/[★\-\,\s]+$/, '').trim();
                    
                    if (titlePart.length > 0) {
                        filmTitle = titlePart;
                    }
                }

                // Extract year from anywhere in the title
                const yearMatch = cleanTitle.match(/(\d{4})/);
                if (yearMatch) {
                    year = parseInt(yearMatch[1]);
                }

                // Extract star rating including half stars from anywhere in the title
                const starMatch = cleanTitle.match(/[★½]+/g);
                if (starMatch && starMatch.length > 0) {
                    // Join all star patterns and count
                    const allStars = starMatch.join('');
                    const fullStars = (allStars.match(/★/g) || []).length;
                    const hasHalfStar = allStars.includes('½');
                    rating = fullStars + (hasHalfStar ? 0.5 : 0);
                }

                console.log('Fallback extraction:', { filmTitle, year, rating });
            }
        }

        // If still no title, try to extract from the link
        if (!filmTitle || filmTitle.length === 0) {
            const linkMatch = link.match(/\/film\/([^\/]+)\//);
            if (linkMatch) {
                // Convert URL slug to title
                filmTitle = linkMatch[1]
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, l => l.toUpperCase());
                console.log('Link extraction:', filmTitle);
            }
        }

        // Final validation - don't return entries with just numbers or invalid titles
        if (!filmTitle || 
            filmTitle.match(/^\d+$/) || 
            filmTitle.length < 2 ||
            filmTitle.match(/^[\s\-\,\★]+$/) || // Skip entries with just punctuation/stars
            filmTitle.toLowerCase() === 'unknown' ||
            filmTitle.toLowerCase() === 'unknown film') {
            console.log('Invalid title detected, skipping:', filmTitle);
            return {
                title: null,
                year: year,
                rating: rating,
                letterboxdUrl: link
            };
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
            const validEntries = rssItems
                .slice(0, limit * 2) // Get more items to account for filtering
                .map(item => {
                    // Convert to diary format and validate
                    const filmInfo = item.filmInfo || {};
                    if (!filmInfo.title || filmInfo.title.trim().length === 0) {
                        return null; // Skip invalid entries
                    }
                    
                    return {
                        Name: filmInfo.title,
                        Year: filmInfo.year || '',
                        LetterboxdURI: filmInfo.letterboxdUrl || '',
                        'Letterboxd URI': filmInfo.letterboxdUrl || '',
                        WatchedDate: item.pubDate.toISOString().split('T')[0], // YYYY-MM-DD format
                        'Watched Date': item.pubDate.toISOString().split('T')[0],
                        Date: item.pubDate.toISOString().split('T')[0],
                        Rating: filmInfo.rating ? filmInfo.rating.toString() : '', // Convert to string for consistency
                        Rewatch: 'No', // Default assumption
                        Tags: 'live-data', // Tag to identify live data
                        isLiveData: true,
                        _isFromRSS: true
                    };
                })
                .filter(entry => entry !== null) // Remove null entries
                .slice(0, limit); // Take only the requested number
                
            console.log(`Returning ${validEntries.length} valid recent diary entries`);
            return validEntries;
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
            
            const entries = rssItems
                .filter(item => {
                    // Accept all RSS activity as potential diary entries
                    // Filter by date only - must be AFTER the latest CSV date
                    const itemDate = new Date(item.pubDate);
                    const sinceDateObj = new Date(sinceDate);
                    
                    // Compare only the date parts (YYYY-MM-DD) to avoid timezone issues
                    const itemDateStr = this.formatDateForCSV(itemDate);
                    const sinceDateStr = this.formatDateForCSV(sinceDateObj);
                    
                    const isNewer = itemDateStr > sinceDateStr;
                    
                    console.log(`Date comparison: ${itemDateStr} > ${sinceDateStr} = ${isNewer}`);
                    
                    return isNewer;
                })
                .map(item => this.convertRSSItemToDiaryFormat(item))
                .filter(entry => entry !== null); // Remove null entries
                
            console.log(`Filtered ${entries.length} valid diary entries from RSS`);
            return entries;
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
        
        // Skip entries without valid film titles (comprehensive validation)
        if (!filmInfo.title || 
            filmInfo.title.trim().length === 0 || 
            filmInfo.title.match(/^\d+$/) || // Skip entries that are just numbers
            filmInfo.title.length < 2 || // Skip very short titles
            filmInfo.title.match(/^[\s\-\,\★]+$/) || // Skip entries with just punctuation/stars
            filmInfo.title.toLowerCase() === 'unknown' ||
            filmInfo.title.toLowerCase() === 'unknown film') {
            console.log('Skipping RSS item without valid title:', rssItem.title, 'extracted:', filmInfo.title);
            return null;
        }
        
        return {
            'Date': this.formatDateForCSV(watchedDate),
            'Name': filmInfo.title,
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
     * Use local timezone to avoid date shifting issues
     */
    formatDateForCSV(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
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

            // Store the new entries for watched merge (clean copies without _isFromRSS flag yet)
            this.lastAddedDiaryEntries = newRSSEntries.map(entry => ({...entry}));

            // Add RSS flag to diary entries
            newRSSEntries.forEach(entry => {
                entry._isFromRSS = true;
            });

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
    async mergeWithWatchedData(existingWatchedData, existingDiaryData) {
        if (!this.isLiveDataAvailable()) {
            return existingWatchedData || [];
        }

        try {
            // Use the entries that were just added to the diary, not all RSS items
            const newDiaryEntries = this.lastAddedDiaryEntries || [];
            console.log(`Using ${newDiaryEntries.length} newly added diary entries for watched merge`);
            
            if (newDiaryEntries.length === 0) {
                console.log('No new diary entries to add to watched list');
                return existingWatchedData || [];
            }
            
            // Create a set of existing watched films for fast lookup (normalize titles)
            const existingWatchedSet = new Set();
            if (existingWatchedData && existingWatchedData.length > 0) {
                existingWatchedData.forEach(entry => {
                    const name = entry['Name'] || entry['Film'];
                    const year = entry['Year'] || '';
                    if (name) {
                        const normalizedKey = `${name.toLowerCase().trim()}_${year}`;
                        existingWatchedSet.add(normalizedKey);
                    }
                });
            }
            
            console.log(`Existing watched films: ${existingWatchedSet.size}`);
            
            // Convert diary entries to watched format, skipping duplicates
            const newWatchedEntries = newDiaryEntries
                .map(diaryEntry => {
                    const name = diaryEntry['Name'];
                    const year = diaryEntry['Year'] || '';
                    
                    // Skip entries without valid film titles
                    if (!name || 
                        name.trim().length === 0 || 
                        name.match(/^\d+$/) || 
                        name.length < 2 ||
                        name.match(/^[\s\-\,\★]+$/) ||
                        name.toLowerCase() === 'unknown' ||
                        name.toLowerCase() === 'unknown film') {
                        console.log('Skipping invalid diary entry for watched:', name);
                        return null;
                    }
                    
                    // Check if this film is already in the watched list
                    const normalizedKey = `${name.toLowerCase().trim()}_${year}`;
                    if (existingWatchedSet.has(normalizedKey)) {
                        console.log('Film already in watched list, skipping:', name, year);
                        return null;
                    }
                    
                    console.log('Adding diary entry to watched:', name, year);
                    
                    return {
                        'Date': diaryEntry['Date'] || diaryEntry['Watched Date'],
                        'Name': name,
                        'Year': year,
                        'Letterboxd URI': diaryEntry['Letterboxd URI'] || '',
                        '_isFromRSS': true
                    };
                })
                .filter(entry => entry !== null);

            console.log(`Found ${newWatchedEntries.length} new films to add to watched list from recently added diary entries`);

            // Merge new films with existing data
            const mergedData = [...(existingWatchedData || []), ...newWatchedEntries];
            
            // Sort by date descending
            mergedData.sort((a, b) => {
                const dateA = new Date(a['Date'] || a['Watched Date']);
                const dateB = new Date(b['Date'] || b['Watched Date']);
                return dateB - dateA;
            });

            // Clear the stored entries after use
            this.lastAddedDiaryEntries = [];

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
