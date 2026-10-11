/* =========================================================
   Cloudline: weather app
   1. Settings and small helpers
   2. Talking to the API (fetch + async/await)
   3. Turning API data into values we can show
   4. Weather icons (inline SVG)
   5. Drawing the page
   6. Screens: loading, error, results, setup
   7. Searching, location, units, recent cities
   8. Start
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. Settings and helpers ---------- */
  const CONFIG = window.CLOUDLINE_CONFIG || {};
  const API_BASE = 'https://api.openweathermap.org/data/2.5';
  const TIMEOUT_MS = Number(CONFIG.TIMEOUT_MS) || 10000;
  const STORE = {
    apiKey: 'cloudline-api-key',
    units: 'cloudline-units',
    last: 'cloudline-last',
    recent: 'cloudline-recent'
  };

  const $ = (selector) => document.querySelector(selector);

  // localStorage can be blocked (private mode, strict settings), so every use is wrapped
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* ignore: the app still works without saving */ }
  }

  function getApiKey() {
    const fromConfig = String(CONFIG.API_KEY || '').trim();
    return fromConfig || readStore(STORE.apiKey) || '';
  }
  function keyComesFromConfig() {
    return String(CONFIG.API_KEY || '').trim() !== '';
  }

  const state = {
    units: readStore(STORE.units) === 'imperial' ? 'imperial' : 'metric',
    lastQuery: null,   // what we searched for last, so Try again and the unit switch can repeat it
    requestId: 0       // lets us ignore an old answer if a newer search has started
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent keeps anything typed by the user safe
    return node;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  /* ---------- 2. The API ---------- */

  // One error type, with a "kind" that tells us what went wrong
  class WeatherError extends Error {
    constructor(kind) {
      super(kind);
      this.name = 'WeatherError';
      this.kind = kind;
    }
  }

  function kindFromStatus(status) {
    if (status === 401) return 'invalidkey';
    if (status === 404) return 'notfound';
    if (status === 429) return 'ratelimit';
    if (status >= 500) return 'server';
    return 'unknown';
  }

  function buildUrl(endpoint, query) {
    const params = new URLSearchParams({ appid: getApiKey(), units: state.units });
    if (query.city) {
      params.set('q', query.city);
    } else {
      params.set('lat', query.lat);
      params.set('lon', query.lon);
    }
    return API_BASE + '/' + endpoint + '?' + params.toString();
  }

  // Fetch one URL and return its JSON, or throw a WeatherError that explains what failed
  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;

    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new WeatherError('timeout');
      // fetch only rejects when the request could not be made at all
      throw new WeatherError(navigator.onLine === false ? 'offline' : 'network');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new WeatherError(kindFromStatus(response.status));

    try {
      return await response.json();
    } catch (err) {
      throw new WeatherError('unknown');
    }
  }

  // Current weather and the forecast are asked for at the same time
  async function fetchWeather(query) {
    const [current, forecast] = await Promise.all([
      fetchJson(buildUrl('weather', query)),
      fetchJson(buildUrl('forecast', query))
    ]);
    return { current: current, forecast: forecast };
  }

  /* ---------- 3. Turning data into display values ---------- */
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The API gives UTC seconds plus the city's offset in seconds. Adding them and then reading the
  // result with the getUTC... methods gives the clock time in that city, whatever the browser's timezone.
  function cityDate(unixSeconds, offsetSeconds) {
    return new Date((unixSeconds + offsetSeconds) * 1000);
  }
  function formatClock(date) {
    const h = date.getUTCHours();
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return ((h % 12) || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function formatHour(date) {
    const h = date.getUTCHours();
    return ((h % 12) || 12) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function dayKey(date) {
    return date.getUTCFullYear() + '-' + date.getUTCMonth() + '-' + date.getUTCDate();
  }
  function degrees(value) {
    return Math.round(value) + '°';
  }
  function unitLabel() {
    return state.units === 'metric' ? '°C' : '°F';
  }

  function formatWind(speed, deg) {
    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const direction = typeof deg === 'number' ? ' ' + compass[Math.round(deg / 45) % 8] : '';
    // metric wind comes in metres per second; people expect km/h
    const value = state.units === 'metric'
      ? Math.round(speed * 3.6) + ' km/h'
      : Math.round(speed) + ' mph';
    return value + direction;
  }

  function formatVisibility(metres) {
    if (typeof metres !== 'number') return 'No data';
    if (state.units === 'metric') return Math.min(metres / 1000, 10).toFixed(1).replace('.0', '') + ' km';
    return Math.min(metres / 1609.34, 10).toFixed(1).replace('.0', '') + ' mi';
  }

  // Which sky colour to paint the main card
  function skyFor(weather) {
    const id = weather.id;
    const night = String(weather.icon).endsWith('n');
    if (id >= 200 && id < 300) return 'thunder';
    if (id >= 300 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'mist';
    if (id === 800 || id === 801 || id === 802) return night ? 'clear-night' : 'clear-day';
    return 'clouds';
  }

  // The forecast comes in 3-hour steps. Group them into days.
  function summariseDays(list, offsetSeconds) {
    const days = new Map();

    list.forEach((item) => {
      const date = cityDate(item.dt, offsetSeconds);
      const key = dayKey(date);
      if (!days.has(key)) {
        days.set(key, { key: key, date: date, min: Infinity, max: -Infinity, pop: 0, weather: item.weather[0], gap: Infinity });
      }
      const day = days.get(key);
      day.min = Math.min(day.min, item.main.temp_min);
      day.max = Math.max(day.max, item.main.temp_max);
      day.pop = Math.max(day.pop, item.pop || 0);

      // show the weather from the step closest to midday
      const gap = Math.abs(date.getUTCHours() - 12);
      if (gap < day.gap) {
        day.gap = gap;
        day.weather = item.weather[0];
      }
    });

    return Array.from(days.values()).slice(0, 5);
  }

  /* ---------- 4. Weather icons ---------- */
  const CLOUD = '<path d="M19 47h27a10.5 10.5 0 0 0 1.6-20.9A14.5 14.5 0 0 0 19.7 29.2 9.1 9.1 0 0 0 19 47z" fill="#E3EAF6" stroke="#7C8DAE" stroke-width="2" stroke-linejoin="round"/>';
  const DARK_CLOUD = '<path d="M19 47h27a10.5 10.5 0 0 0 1.6-20.9A14.5 14.5 0 0 0 19.7 29.2 9.1 9.1 0 0 0 19 47z" fill="#9AA7BF" stroke="#5B6A88" stroke-width="2" stroke-linejoin="round"/>';
  const SUN = '<g stroke="#F59E0B" stroke-width="3.5" stroke-linecap="round">' +
    '<path d="M32 6v6M32 52v6M6 32h6M52 32h6M13.6 13.6l4.2 4.2M46.2 46.2l4.2 4.2M13.6 50.4l4.2-4.2M46.2 17.8l4.2-4.2"/></g>' +
    '<circle cx="32" cy="32" r="11" fill="#FFB703" stroke="#F59E0B" stroke-width="2"/>';
  const MOON = '<path d="M38 10a22 22 0 1 0 16 32A24 24 0 0 1 38 10z" fill="#F4E7A8" stroke="#C9B458" stroke-width="2" stroke-linejoin="round"/>';
  const SMALL_SUN = '<g transform="translate(-9 -9) scale(.62)">' + SUN + '</g>';
  const SMALL_MOON = '<g transform="translate(-4 -6) scale(.62)">' + MOON + '</g>';
  const LOW_CLOUD = '<g transform="translate(5 5)">' + CLOUD + '</g>';
  const RAIN = '<g stroke="#3B82F6" stroke-width="3.5" stroke-linecap="round"><path d="M22 52l-3 7M33 52l-3 7M44 52l-3 7"/></g>';
  const DRIZZLE = '<g stroke="#60A5FA" stroke-width="3" stroke-linecap="round"><path d="M22 53l-2 4M33 53l-2 4M44 53l-2 4"/></g>';
  const BOLT = '<path d="M35 40 26 54h8l-3 9 12-16h-8l4-7z" fill="#FFB703" stroke="#F59E0B" stroke-width="1.5" stroke-linejoin="round"/>';
  const SNOW = '<g fill="#BFD7F5" stroke="#7FA9DC" stroke-width="1.5"><circle cx="23" cy="55" r="2.6"/><circle cx="33" cy="58" r="2.6"/><circle cx="43" cy="55" r="2.6"/></g>';
  const MIST = '<g stroke="#9AA7BF" stroke-width="4" stroke-linecap="round"><path d="M12 24h40M8 34h40M14 44h40M10 54h32"/></g>';

  function iconMarkup(code) {
    const c = String(code || '');
    const night = c.endsWith('n');
    const group = c.slice(0, 2);
    switch (group) {
      case '01': return night ? MOON : SUN;
      case '02': return (night ? SMALL_MOON : SMALL_SUN) + LOW_CLOUD;
      case '03': return CLOUD;
      case '04': return DARK_CLOUD;
      case '09': return DARK_CLOUD + DRIZZLE;
      case '10': return CLOUD + RAIN;
      case '11': return DARK_CLOUD + BOLT;
      case '13': return CLOUD + SNOW;
      case '50': return MIST;
      default: return CLOUD;
    }
  }

  // The markup above is written by us (never user input), so innerHTML is safe here
  function setIcon(node, code) {
    node.innerHTML = '<svg viewBox="0 0 64 64" focusable="false">' + iconMarkup(code) + '</svg>';
  }
  function iconNode(code) {
    const span = el('span', 'wicon');
    span.setAttribute('aria-hidden', 'true');
    setIcon(span, code);
    return span;
  }

  /* ---------- 5. Drawing the page ---------- */
  const ui = {
    app: $('#app'),
    setup: $('#setup'),
    loading: $('#loading'),
    loadingText: $('#loading-text'),
    error: $('#error'),
    errorTitle: $('#error-title'),
    errorText: $('#error-text'),
    retryBtn: $('#retry-btn'),
    changeKeyBtn: $('#change-key-btn'),
    results: $('#results'),
    hero: $('#hero'),
    heroIcon: $('#hero-icon'),
    cityName: $('#city-name'),
    localTime: $('#local-time'),
    temp: $('#temp'),
    tempUnit: $('#temp-unit'),
    condition: $('#condition'),
    hilo: $('#hilo'),
    detailGrid: $('#detail-grid'),
    hourList: $('#hour-list'),
    dayList: $('#day-list'),
    form: $('#search-form'),
    input: $('#city-input'),
    inputError: $('#input-error'),
    searchBtn: $('#search-btn'),
    locateBtn: $('#locate-btn'),
    recent: $('#recent'),
    recentList: $('#recent-list'),
    keyForm: $('#key-form'),
    keyInput: $('#key-input'),
    keyError: $('#key-error'),
    footerKeyBtn: $('#footer-key-btn'),
    unitButtons: Array.from(document.querySelectorAll('.unit-btn'))
  };

  function renderDetails(current) {
    const tz = current.timezone;
    const items = [
      ['Feels like', degrees(current.main.feels_like)],
      ['Humidity', current.main.humidity + '%'],
      ['Wind', formatWind(current.wind ? current.wind.speed : 0, current.wind ? current.wind.deg : undefined)],
      ['Pressure', current.main.pressure + ' hPa'],
      ['Visibility', formatVisibility(current.visibility)],
      ['Cloud cover', (current.clouds ? current.clouds.all : 0) + '%'],
      ['Sunrise', current.sys && current.sys.sunrise ? formatClock(cityDate(current.sys.sunrise, tz)) : 'No data'],
      ['Sunset', current.sys && current.sys.sunset ? formatClock(cityDate(current.sys.sunset, tz)) : 'No data']
    ];

    clear(ui.detailGrid);
    items.forEach((item) => {
      const box = el('div', 'detail');
      box.appendChild(el('dt', '', item[0]));
      box.appendChild(el('dd', '', item[1]));
      ui.detailGrid.appendChild(box);
    });
  }

  function renderHourly(forecast) {
    const tz = forecast.city.timezone;
    clear(ui.hourList);

    forecast.list.slice(0, 8).forEach((item) => {
      const li = el('li', 'hour');
      li.appendChild(el('span', 'hour-time', formatHour(cityDate(item.dt, tz))));
      li.appendChild(iconNode(item.weather[0].icon));
      li.appendChild(el('span', 'hour-temp', degrees(item.main.temp)));
      const rain = Math.round((item.pop || 0) * 100);
      li.appendChild(el('span', 'hour-rain', rain >= 10 ? rain + '% rain' : ' '));
      ui.hourList.appendChild(li);
    });
  }

  function renderDaily(forecast, todayKey) {
    const days = summariseDays(forecast.list, forecast.city.timezone);
    const weekMin = Math.min.apply(null, days.map((d) => d.min));
    const weekMax = Math.max.apply(null, days.map((d) => d.max));
    const range = Math.max(weekMax - weekMin, 1);

    clear(ui.dayList);
    days.forEach((day) => {
      const li = el('li', 'day');

      const label = el('div', 'day-label');
      label.appendChild(el('span', 'day-name', day.key === todayKey ? 'Today' : WEEKDAYS[day.date.getUTCDay()]));
      label.appendChild(el('span', 'day-date', day.date.getUTCDate() + ' ' + MONTHS[day.date.getUTCMonth()]));
      li.appendChild(label);

      li.appendChild(iconNode(day.weather.icon));

      const temps = el('div', 'day-temps');
      temps.appendChild(el('span', 'day-min', degrees(day.min)));
      const track = el('span', 'range');
      track.setAttribute('aria-hidden', 'true');
      const fill = el('span', 'range-fill');
      fill.style.setProperty('--l', ((day.min - weekMin) / range * 100).toFixed(1) + '%');
      fill.style.setProperty('--w', Math.max((day.max - day.min) / range * 100, 6).toFixed(1) + '%');
      track.appendChild(fill);
      temps.appendChild(track);
      temps.appendChild(el('span', 'day-max', degrees(day.max)));
      li.appendChild(temps);

      const rain = Math.round(day.pop * 100);
      li.appendChild(el('span', 'day-rain', rain >= 10 ? rain + '% rain' : ''));

      ui.dayList.appendChild(li);
    });
  }

  function renderWeather(data) {
    const current = data.current;
    const forecast = data.forecast;
    const weather = current.weather[0];
    const tz = current.timezone;
    const now = cityDate(current.dt, tz);

    ui.cityName.textContent = current.name + (current.sys && current.sys.country ? ', ' + current.sys.country : '');
    ui.localTime.textContent = WEEKDAYS[now.getUTCDay()] + ' ' + now.getUTCDate() + ' ' + MONTHS[now.getUTCMonth()] +
      ', ' + formatClock(now) + ' local time';

    ui.hero.dataset.sky = skyFor(weather);
    setIcon(ui.heroIcon, weather.icon);

    ui.temp.textContent = Math.round(current.main.temp);
    ui.tempUnit.textContent = unitLabel();
    ui.condition.textContent = capitalise(weather.description);
    ui.hilo.textContent = 'High ' + degrees(current.main.temp_max) + '  ·  Low ' + degrees(current.main.temp_min);

    renderDetails(current);
    renderHourly(forecast);
    renderDaily(forecast, dayKey(now));

    document.title = ui.cityName.textContent + ' ' + degrees(current.main.temp) + ' | Cloudline';
  }

  /* ---------- 6. Screens ---------- */
  // Only one of these is visible at a time
  function showScreen(name) {
    ui.setup.hidden = name !== 'setup';
    ui.loading.hidden = name !== 'loading';
    ui.error.hidden = name !== 'error';
    ui.results.hidden = name !== 'results';
  }

  function setBusy(busy) {
    ui.app.setAttribute('aria-busy', String(busy));
    ui.searchBtn.disabled = busy;
    ui.locateBtn.disabled = busy;
  }

  function describeError(err, query) {
    const kind = err instanceof WeatherError ? err.kind : 'unknown';
    const searched = query && query.city ? '“' + query.city + '”' : 'that place';

    switch (kind) {
      case 'notfound':
        return { title: 'City not found', text: 'We could not find ' + searched + '. Check the spelling, or add the country, like “Paris, FR”.', retry: false };
      case 'invalidkey':
        return { title: 'The API key was not accepted', text: 'OpenWeatherMap rejected the key. Check that it was copied correctly. A brand-new key can take up to a couple of hours to start working, so you may only need to wait.', retry: true, changeKey: true };
      case 'ratelimit':
        return { title: 'Too many requests', text: 'The free plan allows only a limited number of requests per minute. Wait a minute and try again.', retry: true };
      case 'offline':
        return { title: 'You seem to be offline', text: 'Check your internet connection, then try again.', retry: true };
      case 'network':
        return { title: 'Could not reach the weather service', text: 'The request did not go through. Check your connection and try again.', retry: true };
      case 'timeout':
        return { title: 'The weather service is too slow', text: 'It took longer than ' + Math.round(TIMEOUT_MS / 1000) + ' seconds to answer. Try again in a moment.', retry: true };
      case 'server':
        return { title: 'The weather service has a problem', text: 'This is on their side, not yours. Try again in a little while.', retry: true };
      case 'geodenied':
        return { title: 'Location permission was denied', text: 'Allow location access for this page in your browser, or search for a city by name instead.', retry: false };
      case 'nogeo':
        return { title: 'Location is not available', text: 'This browser cannot share your location. Search for a city by name instead.', retry: false };
      case 'geofail':
        return { title: 'Could not find your location', text: 'Your device did not share a location in time. Try again, or search for a city by name.', retry: false };
      default:
        return { title: 'Something went wrong', text: 'Something unexpected happened. Try again, or search for a different city.', retry: true };
    }
  }

  function showError(err, query) {
    const info = describeError(err, query);
    ui.errorTitle.textContent = info.title;
    ui.errorText.textContent = info.text;
    ui.retryBtn.hidden = !(info.retry && state.lastQuery);
    ui.changeKeyBtn.hidden = !(info.changeKey && !keyComesFromConfig());
    showScreen('error');
  }

  /* ---------- 7. Searching, location, units, recent cities ---------- */
  async function loadWeather(query) {
    if (!getApiKey()) {
      showScreen('setup');
      return;
    }

    const myId = ++state.requestId;
    state.lastQuery = query;
    ui.loadingText.textContent = query.city ? 'Loading weather for ' + query.city + '…' : 'Loading weather…';
    setBusy(true);
    showScreen('loading');

    try {
      const data = await fetchWeather(query);
      if (myId !== state.requestId) return;          // a newer search has started, ignore this answer
      renderWeather(data);
      rememberCity(data.current);
      showScreen('results');
    } catch (err) {
      if (myId !== state.requestId) return;
      showError(err, query);
    } finally {
      if (myId === state.requestId) setBusy(false);
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new WeatherError('nogeo'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        resolve,
        (err) => reject(new WeatherError(err.code === 1 ? 'geodenied' : 'geofail')),
        { timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  async function useMyLocation() {
    if (!getApiKey()) {
      showScreen('setup');
      return;
    }
    const myId = ++state.requestId;
    ui.loadingText.textContent = 'Finding your location…';
    setBusy(true);
    showScreen('loading');

    let position;
    try {
      position = await getPosition();
    } catch (err) {
      if (myId === state.requestId) {
        setBusy(false);
        showError(err);
      }
      return;
    }
    if (myId !== state.requestId) return;

    await loadWeather({
      lat: position.coords.latitude.toFixed(4),
      lon: position.coords.longitude.toFixed(4)
    });
  }

  function showInputError(message) {
    ui.inputError.textContent = message;
    if (message) ui.input.setAttribute('aria-invalid', 'true');
    else ui.input.removeAttribute('aria-invalid');
  }

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const city = ui.input.value.trim();

    if (!city) {
      showInputError('Type a city name first, for example Lahore.');
      ui.input.focus();
      return;
    }
    if (!/\p{L}/u.test(city)) {
      showInputError('Use letters for the city name, for example Lahore or Paris, FR.');
      ui.input.focus();
      return;
    }
    showInputError('');
    loadWeather({ city: city });
  });

  ui.input.addEventListener('input', () => showInputError(''));
  ui.locateBtn.addEventListener('click', useMyLocation);

  ui.retryBtn.addEventListener('click', () => {
    if (state.lastQuery) loadWeather(state.lastQuery);
  });

  // Units: the API converts the numbers for us, so we simply ask again
  function syncUnitButtons() {
    ui.unitButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.units === state.units));
    });
  }

  ui.unitButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.units === state.units) return;
      state.units = btn.dataset.units;
      writeStore(STORE.units, state.units);
      syncUnitButtons();
      if (state.lastQuery) loadWeather(state.lastQuery);
    });
  });

  // Recent cities
  function readRecent() {
    try {
      const list = JSON.parse(readStore(STORE.recent) || '[]');
      return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 5) : [];
    } catch (e) {
      return [];
    }
  }

  function renderRecent() {
    const list = readRecent();
    ui.recent.hidden = list.length === 0;
    clear(ui.recentList);

    list.forEach((query) => {
      const li = el('li');
      const btn = el('button', 'chip', query.replace(',', ', '));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        ui.input.value = btn.textContent;
        showInputError('');
        loadWeather({ city: query });
      });
      li.appendChild(btn);
      ui.recentList.appendChild(li);
    });
  }

  function rememberCity(current) {
    const country = current.sys && current.sys.country;
    const query = country ? current.name + ',' + country : current.name;
    const others = readRecent().filter((x) => x.toLowerCase() !== query.toLowerCase());
    writeStore(STORE.recent, JSON.stringify([query].concat(others).slice(0, 5)));
    writeStore(STORE.last, query);
    renderRecent();
  }

  // API key (first run, or when the person wants to change it)
  function updateKeyButtons() {
    ui.footerKeyBtn.hidden = keyComesFromConfig() || !readStore(STORE.apiKey);
  }

  function askForKey() {
    writeStore(STORE.apiKey, null);
    updateKeyButtons();
    ui.keyError.textContent = '';
    showScreen('setup');
    ui.keyInput.focus();
  }

  ui.keyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = ui.keyInput.value.trim();

    if (!/^[a-f0-9]{32}$/i.test(key)) {
      ui.keyError.textContent = 'An OpenWeatherMap key is 32 letters and numbers. Copy it again from your account page.';
      ui.keyInput.setAttribute('aria-invalid', 'true');
      ui.keyInput.focus();
      return;
    }
    ui.keyInput.removeAttribute('aria-invalid');
    ui.keyError.textContent = '';
    ui.keyInput.value = '';
    writeStore(STORE.apiKey, key);
    updateKeyButtons();
    start();
  });
  ui.keyInput.addEventListener('input', () => {
    ui.keyError.textContent = '';
    ui.keyInput.removeAttribute('aria-invalid');
  });

  ui.changeKeyBtn.addEventListener('click', askForKey);
  ui.footerKeyBtn.addEventListener('click', askForKey);

  /* ---------- 8. Start ---------- */
  function start() {
    if (!getApiKey()) {
      showScreen('setup');
      return;
    }
    const city = readStore(STORE.last) || CONFIG.DEFAULT_CITY || 'Lahore';
    ui.input.value = city.replace(',', ', ');
    loadWeather({ city: city });
  }

  syncUnitButtons();
  renderRecent();
  updateKeyButtons();
  start();
})();
