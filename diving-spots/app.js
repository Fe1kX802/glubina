// DiveSpots Application - Interactive Map for Divers

// Global variables
let map;
let waterBodiesLayer;
let currentWaterBody = null;
let ratings = {};
let reviews = {};

// Initialize the map
function initMap() {
    // Create map centered on a default location (can be changed based on user's location)
    map = L.map('map').setView([55.7558, 37.6173], 10); // Moscow by default
    
    // Add grayscale tile layer from OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(map);
    
    // Apply grayscale filter to tiles
    const tileElements = document.querySelectorAll('.leaflet-tile');
    tileElements.forEach(tile => {
        tile.style.filter = 'grayscale(100%)';
    });
    
    // Monitor tile loading to apply grayscale to new tiles
    map.on('tileload', function(e) {
        e.tile.style.filter = 'grayscale(100%)';
    });
    
    // Create SVG pattern for hatching
    createHatchPattern();
    
    // Initialize layers
    waterBodiesLayer = L.layerGroup().addTo(map);
    
    // Load water bodies from Overpass API
    loadWaterBodies();
    
    // Setup event listeners
    setupEventListeners();
}

// Create hatch pattern for water bodies
function createHatchPattern() {
    const svgContainer = document.createElement('div');
    svgContainer.style.display = 'none';
    svgContainer.innerHTML = `
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <pattern id="hatch-pattern" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="10" stroke="#2980b9" stroke-width="2" />
                </pattern>
            </defs>
        </svg>
    `;
    document.body.appendChild(svgContainer);
}

// Load water bodies from Overpass API
async function loadWaterBodies() {
    const bounds = map.getBounds();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();
    
    const overpassQuery = `
        [out:json][timeout:25];
        (
          way["natural"="water"](${south},${west},${north},${east});
          relation["natural"="water"](${south},${west},${north},${east});
          way["leisure"="swimming_pool"](${south},${west},${north},${east});
          way["waterway"="river"](${south},${west},${north},${east});
          way["waterway"="stream"](${south},${west},${north},${east});
        );
        out body;
        >;
        out skel qt;
    `;
    
    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: overpassQuery
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const data = await response.json();
        renderWaterBodies(data);
    } catch (error) {
        console.error('Error loading water bodies:', error);
        showNotification('Ошибка загрузки данных о водоемах. Попробуйте позже.', 'error');
    }
}

// Render water bodies on the map
function renderWaterBodies(data) {
    waterBodiesLayer.clearLayers();
    
    const elements = data.elements;
    const ways = {};
    const relations = {};
    
    // Process nodes
    elements.forEach(element => {
        if (element.type === 'node') {
            ways[element.id] = {
                lat: element.lat,
                lon: element.lon
            };
        }
    });
    
    // Process ways
    elements.forEach(element => {
        if (element.type === 'way' && element.nodes) {
            const coords = element.nodes.map(nodeId => {
                if (ways[nodeId]) {
                    return [ways[nodeId].lat, ways[nodeId].lon];
                }
                return null;
            }).filter(coord => coord !== null);
            
            if (coords.length > 2) {
                const tags = element.tags || {};
                const name = tags.name || tags['name:ru'] || 'Без названия';
                const type = getWaterType(tags);
                
                // Create polygon with blue fill and hatching
                const polygon = L.polygon(coords, {
                    color: '#2980b9',
                    weight: 2,
                    opacity: 1,
                    fillColor: '#3498db',
                    fillOpacity: 0.5,
                    className: 'water-body'
                });
                
                // Store metadata
                polygon.waterData = {
                    id: element.id,
                    name: name,
                    type: type,
                    area: calculateArea(coords),
                    tags: tags
                };
                
                // Add click event
                polygon.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    showWaterBodyDetails(this.waterData);
                });
                
                // Add popup
                polygon.bindTooltip(name, {
                    permanent: false,
                    direction: 'center',
                    className: 'water-tooltip'
                });
                
                waterBodiesLayer.addLayer(polygon);
            }
        }
    });
}

// Determine water body type from OSM tags
function getWaterType(tags) {
    if (tags.natural === 'water') {
        if (tags.water === 'lake') return 'Озеро';
        if (tags.water === 'pond') return 'Пруд';
        if (tags.water === 'reservoir') return 'Водохранилище';
        return 'Водоем';
    }
    if (tags.leisure === 'swimming_pool') return 'Бассейн';
    if (tags.waterway === 'river') return 'Река';
    if (tags.waterway === 'stream') return 'Ручей';
    return 'Водоем';
}

// Calculate approximate area in hectares
function calculateArea(coords) {
    // Simplified area calculation
    if (coords.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
        const j = (i + 1) % coords.length;
        area += coords[i][0] * coords[j][1];
        area -= coords[j][0] * coords[i][1];
    }
    
    area = Math.abs(area) / 2;
    // Convert to approximate hectares (very rough estimate)
    return (area * 111 * 111).toFixed(2);
}

// Show water body details in modal
function showWaterBodyDetails(waterData) {
    currentWaterBody = waterData;
    
    document.getElementById('modal-title').textContent = waterData.name;
    document.getElementById('water-type').textContent = waterData.type;
    document.getElementById('water-area').textContent = waterData.area + ' га';
    
    // Load saved ratings
    const savedRating = ratings[waterData.id] || {
        depth: 0,
        clarity: 0,
        access: 0,
        infrastructure: 0,
        overall: 0
    };
    
    updateDepthDisplay(savedRating.depth);
    updateStarDisplay('clarity-stars', savedRating.clarity);
    updateStarDisplay('access-stars', savedRating.access);
    updateStarDisplay('infrastructure-stars', savedRating.infrastructure);
    updateStarDisplay('overall-stars', savedRating.overall);
    
    // Load reviews
    displayReviews(waterData.id);
    
    // Show modal
    document.getElementById('modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
}

// Update depth value display
function updateDepthDisplay(value) {
    const symbols = ['-', '0', '+'];
    document.getElementById('depth-value').textContent = symbols[value + 1];
}

// Update star rating display
function updateStarDisplay(containerId, value) {
    const container = document.getElementById(containerId);
    const stars = container.querySelectorAll('.star');
    
    stars.forEach((star, index) => {
        if (index < value) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
}

// Display reviews for a water body
function displayReviews(waterBodyId) {
    const reviewsList = document.getElementById('reviews-list');
    const waterReviews = reviews[waterBodyId] || [];
    
    if (waterReviews.length === 0) {
        reviewsList.innerHTML = '<p style="color: #7f8c8d; text-align: center;">Пока нет отзывов</p>';
        return;
    }
    
    reviewsList.innerHTML = waterReviews.map(review => `
        <div class="review-item">
            <small>${new Date(review.date).toLocaleDateString('ru-RU')}</small>
            <p>${review.text}</p>
        </div>
    `).join('');
}

// Setup event listeners
function setupEventListeners() {
    // Close modal buttons
    document.querySelector('.close-btn').addEventListener('click', closeModal);
    document.querySelector('.close-review-btn').addEventListener('click', closeReviewModal);
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('modal');
        const reviewModal = document.getElementById('review-modal');
        if (event.target === modal) {
            closeModal();
        }
        if (event.target === reviewModal) {
            closeReviewModal();
        }
    });
    
    // Depth rating buttons
    document.querySelectorAll('.rate-btn[data-param="depth"]').forEach(btn => {
        btn.addEventListener('click', function() {
            const value = parseInt(this.dataset.value);
            if (!ratings[currentWaterBody.id]) {
                ratings[currentWaterBody.id] = {};
            }
            ratings[currentWaterBody.id].depth = value;
            updateDepthDisplay(value);
        });
    });
    
    // Star rating systems
    ['clarity', 'access', 'infrastructure', 'overall'].forEach(param => {
        const stars = document.querySelectorAll(`#${param}-stars .star`);
        stars.forEach(star => {
            star.addEventListener('click', function() {
                const value = parseInt(this.dataset.value);
                if (!ratings[currentWaterBody.id]) {
                    ratings[currentWaterBody.id] = {};
                }
                ratings[currentWaterBody.id][param] = value;
                updateStarDisplay(`${param}-stars`, value);
            });
            
            star.addEventListener('mouseenter', function() {
                const value = parseInt(this.dataset.value);
                highlightStars(`${param}-stars`, value);
            });
        });
        
        document.getElementById(`${param}-stars`).addEventListener('mouseleave', function() {
            const savedValue = ratings[currentWaterBody.id]?.[param] || 0;
            updateStarDisplay(`${param}-stars`, savedValue);
        });
    });
    
    // Save rating button
    document.getElementById('save-rating-btn').addEventListener('click', saveRatings);
    
    // Add review button
    document.getElementById('add-review-btn').addEventListener('click', function() {
        document.getElementById('review-modal').style.display = 'block';
    });
    
    // Review form submission
    document.getElementById('review-form').addEventListener('submit', submitReview);
    
    // Map move end - reload water bodies for new area
    map.on('moveend', function() {
        loadWaterBodies();
    });
}

// Highlight stars on hover
function highlightStars(containerId, value) {
    const container = document.getElementById(containerId);
    const stars = container.querySelectorAll('.star');
    
    stars.forEach((star, index) => {
        if (index < value) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
}

// Save ratings to localStorage
function saveRatings() {
    if (!currentWaterBody) return;
    
    // Save to localStorage
    const allRatings = JSON.parse(localStorage.getItem('diveSpotsRatings') || '{}');
    allRatings[currentWaterBody.id] = ratings[currentWaterBody.id];
    localStorage.setItem('diveSpotsRatings', JSON.stringify(allRatings));
    
    showNotification('Оценка сохранена!', 'success');
    closeModal();
}

// Submit review
function submitReview(e) {
    e.preventDefault();
    
    const reviewText = document.getElementById('review-text').value.trim();
    if (!reviewText || !currentWaterBody) return;
    
    if (!reviews[currentWaterBody.id]) {
        reviews[currentWaterBody.id] = [];
    }
    
    reviews[currentWaterBody.id].push({
        text: reviewText,
        date: new Date().toISOString()
    });
    
    // Save to localStorage
    const allReviews = JSON.parse(localStorage.getItem('diveSpotsReviews') || '{}');
    if (!allReviews[currentWaterBody.id]) {
        allReviews[currentWaterBody.id] = [];
    }
    allReviews[currentWaterBody.id].push({
        text: reviewText,
        date: new Date().toISOString()
    });
    localStorage.setItem('diveSpotsReviews', JSON.stringify(allReviews));
    
    // Clear form and close modal
    document.getElementById('review-text').value = '';
    closeReviewModal();
    
    // Refresh reviews display
    displayReviews(currentWaterBody.id);
    
    showNotification('Отзыв добавлен!', 'success');
}

// Close main modal
function closeModal() {
    document.getElementById('modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    currentWaterBody = null;
}

// Close review modal
function closeReviewModal() {
    document.getElementById('review-modal').style.display = 'none';
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 5px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 2000;
        animation: slideInRight 0.3s;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Load saved data from localStorage
function loadSavedData() {
    ratings = JSON.parse(localStorage.getItem('diveSpotsRatings') || '{}');
    reviews = JSON.parse(localStorage.getItem('diveSpotsReviews') || '{}');
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    loadSavedData();
    initMap();
});

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
