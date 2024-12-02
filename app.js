const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// Define the file path for persistent storage
const dataDirectory = path.join(__dirname, 'data');

// Ensure the data directory exists
if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory); // Create the 'data' directory if it does not exist
}

const bookingsFilePath = path.join(dataDirectory, 'bookings.json');
const deliveryDoneListFilePath = path.join(dataDirectory, 'deliveryDoneList.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Set up Multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

// Function to read data from file
const readDataFromFile = (filePath) => {
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        return JSON.parse(data);
    }
    return []; // Returns empty array if file does not exist
};

// Function to write data to file
const writeDataToFile = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Load bookings and deliveryDoneList from persistent storage
let bookings = readDataFromFile(bookingsFilePath);
let deliveryDoneList = readDataFromFile(deliveryDoneListFilePath);

// Route for home page
app.get('/', (req, res) => {
    res.render('index', { bookings });
});

// Route to handle file upload
app.post('/upload', upload.single('file'), (req, res) => {
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    // Create a Set to keep track of existing UTRs
    const existingUtrs = new Set(bookings.map(b => b["UTR"])); // assuming UTR is the key in the booking data
    const duplicateUtrs = [];

    data.forEach((entry) => {
        if (existingUtrs.has(entry["UTR"])) { // check for duplicate UTR
            duplicateUtrs.push(entry["UTR"]);
        }
    });

    if (duplicateUtrs.length > 0) {
        return res.render('index', { bookings, message: `The following UTRs are already registered: ${duplicateUtrs.join(', ')}` });
    }

    bookings = data; // Store bookings data for this session
    writeDataToFile(bookingsFilePath, bookings); // Persist data to file
    res.render('index', { bookings }); // Re-render index to show booking history
});

// Route for Maturity List
app.get('/maturity-list', (req, res) => {
    const today = new Date();
    const maturityBookings = bookings.filter(booking => {
        const depositDate = new Date(booking["DEPOSIT DATE"]);
        const maturityDate = new Date(depositDate);
        maturityDate.setMonth(depositDate.getMonth() + 9); // Assuming maturity period is 9 months
        return maturityDate <= today; // Check if matured
    });
    res.render('maturity-list', { bookings: maturityBookings });
});

// Route for Claim Now
app.post('/claim-now', (req, res) => {
    const { id } = req.body; // Get the ID of the booking
    const booking = bookings.find(b => b["CUSTOMER ID"] === id); // Find booking
    if (booking) {
        res.render('claim-now', { booking });
    } else {
        res.status(404).send('Booking not found');
    }
});

// Route for Pay Now
app.post('/pay-now', (req, res) => {
    const { utr, maturityAmount, customerId } = req.body;

    // Check for duplicate UTR when processing payment
    if (deliveryDoneList.some(d => d.maturityUtr === utr)) {
        return res.status(400).send('UTR already registered for a claim.');
    }

    // Find the associated booking and mark it as delivered
    const index = bookings.findIndex(b => b["CUSTOMER ID"] === customerId);
    if (index !== -1) {
        deliveryDoneList.push({
            deliveryNo: `VIP${deliveryDoneList.length + 1}`,
            customerName: bookings[index]["CUSTOMER NAME"],
            customerId,
            maturityUtr: utr,
            maturityAmount
        });
        bookings.splice(index, 1); // Remove from bookings
        writeDataToFile(bookingsFilePath, bookings); // Update bookings in file
        writeDataToFile(deliveryDoneListFilePath, deliveryDoneList); // Persist delivery done list
        res.render('delivery-done', { deliveries: deliveryDoneList, bookings }); // Pass bookings for print functionality
    } else {
        res.status(404).send('Booking not found to deliver');
    }
});

// Route for Delivery Done List
app.get('/delivery-done', (req, res) => {
    res.render('delivery-done', { deliveries: deliveryDoneList, bookings }); // Include bookings data
});

// Route for deleting bookings in the Maturity List
app.post('/delete-maturity', (req, res) => {
    const { id } = req.body; // Get the CUSTOMER ID to delete
    bookings = bookings.filter(b => b["CUSTOMER ID"] !== id);
    writeDataToFile(bookingsFilePath, bookings);
    res.redirect('/maturity-list');
});

// Route for deleting deliveries in the Delivery Done List
app.post('/delete-delivery', (req, res) => {
    const { id } = req.body; // Get the CUSTOMER ID to delete
    deliveryDoneList = deliveryDoneList.filter(d => d.customerId !== id);
    writeDataToFile(deliveryDoneListFilePath, deliveryDoneList);
    res.redirect('/delivery-done');
});

// Route for deleting bookings from the Uploaded Booking History
app.post('/delete-booking', (req, res) => {
    const { id } = req.body; // Get the CUSTOMER ID to delete
    bookings = bookings.filter(b => b["CUSTOMER ID"] !== id);
    writeDataToFile(bookingsFilePath, bookings);
    res.redirect('/');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});