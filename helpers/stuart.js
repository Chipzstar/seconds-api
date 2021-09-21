const {AUTHORIZATION_KEY} = require("../constants");
const db = require("../models");

exports.deliveryUpdate = async (req, res) => {
	try {
		//if event is a delivery update
		const { event, type } = req.body;
		let data = {
			message: "event unrecognised"
		}
		if (event && event === "job") {
			if (type && type === "create") {
				console.log("JOB CREATE")
				console.log({...req.body.data})
				console.log({STATUS: req.body.status})
				data = { ...req.body.data, status: req.body.status}
			}
			if (type && type === "update") {
				console.log("JOB UPDATE")
				console.log({...req.body.data})
				console.log({STATUS: req.body.status})
				data = { ...req.body.data, status: req.body.status}
			}
		}
		if (event && event === "delivery") {
			if (type && type === "create") {
				console.log("DELIVERY CREATE")
				console.log({...req.body.data})
				console.log({STATUS: req.body.status})
				data = { ...req.body.data, status: req.body.status}
			}
			if (type && type === "update") {
				console.log("DELIVERY UPDATE")
				console.log({...req.body.data})
				console.log({STATUS: req.body.status})
				data = { ...req.body.data, status: req.body.status}
				// const foundJob = await db.Job.findOne({"clientReferenceNumber": clientReferenceNumber}, {})
				// console.log(foundJob)
			}
		}
		return res.status(200).json({
			...data
		})
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
}