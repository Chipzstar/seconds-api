require("dotenv").config();
const express = require("express");
const router = express.Router();

router.post("/", async (req, res) => {
	try {
		const baseURL = "https://stage-api.streetstreamdev.co.uk";
	    res.status(200).send({
		    baseURL
	    })
	} catch (err) {
	    console.error(err)
		res.status(500).json({
			error: { ...err}
		})
	}
})

module.exports = router;