const express = require('express');
const { AUTHORIZATION_KEY, DELIVERY_TYPES } = require('../constants');
const {
	getClientDetails,
	getResultantQuotes,
	chooseBestProvider,
	getVehicleSpecs,
	calculateJobDistance
} = require('../helpers');
const moment = require('moment');
const db = require('../models');
const router = express.Router();

/*
 * Get Quotes - The API endpoint for retrieving the bestQuote and the list of quotes from relative providers
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/', async (req, res) => {
	try {
		const user = await getClientDetails(req.headers[AUTHORIZATION_KEY]);
		const settings = await db.Settings.findOne({clientId: user['_id']})
		console.log('Strategy: ', user['selectionStrategy']);
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(req.body.vehicleType);
		console.table(vehicleSpecs);
		// calculate job distance
		const jobDistance = await calculateJobDistance(
			req.body.pickupAddress,
			req.body.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// Check if a job is an on-demand job, and override and set pickup/dropoff times
		if (req.body.packageDeliveryType === DELIVERY_TYPES.ON_DEMAND.name) {
			req.body.packagePickupStartTime = moment().add(20, 'minutes').format();
			req.body.drops[0].packageDropoffEndTime = moment().add(120, 'minutes').format();
		}
		const quotes = await getResultantQuotes(req.body, vehicleSpecs, jobDistance, settings);
		const bestQuote = chooseBestProvider(user['selectionStrategy'], quotes);
		if (!bestQuote) {
			const error = new Error('No couriers available at this time. Please try again later!');
			error.status = 500;
			throw error
		}
		return res.status(200).json({
			quotes,
			bestQuote
		});
	} catch (err) {
		console.log(err);
		return err.message
			? res.status(err.status).json({
					error: {
						code: err.status,
						message: err.message
					}
			  })
			: res.status(500).json({
					error: {
						code: 500,
						message: 'Unknown error occurred!'
					}
			  });
	}
});

module.exports = router;
