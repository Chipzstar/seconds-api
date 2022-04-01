const express = require('express');
const { updateJob, updateDelivery, updateDriverETA, getStuartAuthToken } = require('../helpers/couriers/stuart');
const { sendWebhookUpdate } = require('../helpers');
const router = express.Router();

router.post('/delivery-update', async (req, res) => {
	try {
		//if event is a delivery update
		const { event, type, data } = req.body;
		let job = null;
		if (event && event === 'job') {
			if (type && type === 'create') {
				console.log('JOB CREATE');
				job = await updateJob(data);
				job && sendWebhookUpdate(job, `${event}.${type}`).then().catch()
			}
			if (type && type === 'update') {
				console.log('JOB UPDATE');
				job = await updateJob(data);
				job && sendWebhookUpdate(job, `${event}.${type}`).then().catch()
			}
		} else if (event && event === 'delivery') {
			if (type && type === 'create') {
				console.log('DELIVERY CREATE');
				job = await updateDelivery(data);
				job && sendWebhookUpdate(job, `${event}.${type}`).then().catch()
			}
			if (type && type === 'update') {
				console.log('DELIVERY UPDATE');
				job = await updateDelivery(data);
				job && sendWebhookUpdate(job, `${event}.${type}`).then().catch()
			}
		} else if (event && event === 'driver'){
			if (type && type === 'update'){
				job = await updateDriverETA(data)
				job && sendWebhookUpdate(job, `${event}.${type}`).then().catch()
			}
		}
		return res.status(200).json({
			success: true,
			status: `${type.toUpperCase()}/${event.toUpperCase()}`
		});
	} catch (err) {
		console.error(err);
		return res.status(200).json({
			success: false,
			status: 'EVENT_UNRECOGNISED',
			message: err.message,
		});
	}
});

router.get('/auth', async (req, res) => {
	try {
		const token = await getStuartAuthToken();
		return res.status(200).json({
			token,
			status: 'success',
		});
	} catch (err) {
		console.error(err);
		res.status(400).json(err.response)
	}
});

module.exports = router;

