const axios = require('axios');
const { ERROR_MESSAGES } = require('../constants/stuart');
const axiosRetry = require('axios-retry');
// HELPERS
const { updateHerokuConfigVars } = require('../helpers/heroku');
const { getStuartAuthToken } = require('../helpers/couriers/stuart');
const { authStreetStream } = require('../helpers/couriers/streetStream');

// setup axios instances
const stuartAxios = axios.create();
const streetStreamAxios = axios.create();
const webhookAxios = axios.create();

stuartAxios.defaults.headers.common['Authorization'] = `Bearer ${process.env.STUART_API_KEY}`;
streetStreamAxios.defaults.headers.common['Authorization'] = `Bearer ${process.env.STREET_STREAM_API_KEY}`;
// if fails, retry request with exponential backoff
axiosRetry(webhookAxios, { retries: 3, retryDelay: axiosRetry.exponentialDelay, retryCondition: _error => true });
// set GLOBAL config-vars object for updating multiple heroku env variables
let CONFIG_VARS = {};
let stuartTimeout;
let streetStreamTimeout;

stuartAxios.interceptors.response.use(
	response => {
		return response;
	},
	error => {
		if (
			error.response &&
			error.response.status === 401 &&
			error.response.data.message === ERROR_MESSAGES.ACCESS_TOKEN_REVOKED
		) {
			return getStuartAuthToken()
				.then(token => {
					// clear any ongoing timeouts
					stuartTimeout && clearTimeout(stuartTimeout);
					streetStreamTimeout && clearTimeout(streetStreamTimeout);
					// update config vars
					CONFIG_VARS = { ...CONFIG_VARS, STUART_API_KEY: token };
					// set the timeout to update config vars after 20s
					stuartTimeout =
						process.env.NODE_ENV === 'production'
							? setTimeout(() => {
								updateHerokuConfigVars(CONFIG_VARS).then(() => {
									// set the timeout variable to be null
									stuartTimeout = null;
									// remove old config vars from the global cache object
									CONFIG_VARS = {};
								});
							}, 20000)
							: null;
					error.config.headers['Authorization'] = `Bearer ${token}`;
					return stuartAxios.request(error.config);
				})
				.catch(err => Promise.reject(err));
		}
		return Promise.reject(error);
	}
);

streetStreamAxios.interceptors.response.use(
	response => response,
	error => {
		console.error(error.response);
		if (error.response && error.response.status === 403) {
			return authStreetStream()
				.then(token => {
					// clear any ongoing timeouts
					stuartTimeout && clearTimeout(stuartTimeout);
					streetStreamTimeout && clearTimeout(streetStreamTimeout);
					// update config-vars
					CONFIG_VARS = { ...CONFIG_VARS, STREET_STREAM_API_KEY: token };
					// set the timeout to update config vars after 20s
					streetStreamTimeout =
						process.env.NODE_ENV === 'production'
							? setTimeout(() => {
								updateHerokuConfigVars(CONFIG_VARS).then(() => {
									// set the timeout variable to be null
									stuartTimeout = null;
									// remove old config vars from the global cache object
									CONFIG_VARS = {};
								});
							}, 20000)
							: null;
					error.config.headers['Authorization'] = `Bearer ${token}`;
					return streetStreamAxios.request(error.config);
				})
				.catch(err => Promise.reject(err));
		}
		return Promise.reject(error);
	}
);

module.exports = { stuartAxios, streetStreamAxios }