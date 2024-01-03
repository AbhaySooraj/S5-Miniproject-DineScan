// include the necessary libraries
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const mysql2 = require("mysql2");
const dotenv = require("dotenv");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");

// define constants
const app = express();
const port = 3000;

// load the environment variables from .env file
dotenv.config();
// middleware to parse incoming JSON requests and parse the incoming form data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

// set the view engine to EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));

// setting up multer to handle file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Specify the directory where you want to store the uploaded images
    const uploadDir = path.join(__dirname, "public/images/uploads");
    // Create the directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate a unique filename for the uploaded image
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExtension = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + fileExtension);
  },
});

const upload = multer({ storage: storage });

// create a connection to the MySQL server
const pool = mysql2.createPool({
  host: process.env.DBMS_host,
  user: process.env.DBMS_user,
  password: process.env.DBMS_password,
  database: process.env.DBMS_database,
  multipleStatements: true,
  authPlugins: {
    mysql_clear_password: () => () =>
      Buffer.from(process.env.DBMS_password + "\0"),
  },
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error("Error connecting to MySQL pool:", err);
    return;
  }
  console.log("Connected to MySQL pool");
  // Release the connection back to the pool
  connection.release();
});

// session middleware
app.use(session({
  secret: '188502',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.get("/login", (req, res) => {
  res.render("login");
});

// Define a middleware to check authentication status
const isAuthenticated = (req, res, next) => {
  // Check if the user is authenticated
  if (req.session.authenticated) {
    // If authenticated, proceed to the next middleware or route handler
    next();
  } else {
    // If not authenticated, redirect to the login page
    res.redirect("/login");
  }
};

app.post("/login", (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error('Error acquiring a connection from the pool:', error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query the database to check if the provided credentials are valid
    const query = "SELECT * FROM users WHERE username = ? AND password = ?";
    connection.query(query, [username, password], (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
      } else {
        // Check if there is a matching user
        if (results.length > 0) {
          // Authentication successful
          req.session.authenticated = true;
          req.session.username = username;
          const role = results[0].role;
          req.session.role = role;
          if (role == "admin") {
            console.log("Authentication successful: Redirected to admin dashboard");
            res.redirect("/admin-dashboard");
          } else if (role == "staff") {
            console.log("Authentication successful: Redirected to staff dashboard");
            res.redirect("/staff-dashboard");
          } else if (role == "superuser") {
            console.log("Authentication successful: Redirected to superuser dashboard");
            res.redirect("superuser-dashboard");
          }
        } else {
          // Authentication failed
          console.log("Authentication error");
          res.redirect("/login");
        }
      }
    });
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    } else {
      // Redirect to the login page or any other page after logout
      res.redirect("/login");
    }
  });
});

app.post("/api/upload-dish-image", upload.single("file"), (req, res) => {
  // Check if a file was provided in the request
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided" });
    console.log('no image');
  }

  // Get the file path of the uploaded image
  const imagePath = req.file.filename;
  // Return the image path in the response
  res.json({ imagePath });
});

app.get("/admin-dashboard", (req, res) => {
  res.redirect("/admin-dashboard/overview");
});

app.get("/admin-dashboard/overview", isAuthenticated, (req, res) => {
  res.render("admin-dashboard/overview.ejs", { username: req.session.username, role: req.session.role });
});

app.get("/admin-dashboard/access-control", isAuthenticated, (req, res) => {
  // Check if the user has the role 'superuser'
  if (req.session.role === 'superuser') {
    // Redirect to superuser dashboard
    return res.redirect("/superuser-dashboard/access-control");
  }
  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error("Error acquiring a connection from the pool:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query to fetch all staff members from the "users" table
    const query = 'SELECT * FROM users WHERE role = "staff"';

    connection.query(query, (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
      } else {
        // Render the EJS template with the retrieved staff details
        res.render("admin-dashboard/access-control.ejs", {
          username: req.session.username,
          staff: results,
          role: req.session.role
        });
      }
    });
  });
});

app.get("/admin-dashboard/orders", (req, res) => {
  res.redirect("/admin-dashboard/orders/1");
});

// Add this route to handle orders
app.get("/admin-dashboard/orders/:page", isAuthenticated, (req, res) => {
  const itemsPerPage = 10;
  const page = req.params.page;
  const offset = (page - 1) * itemsPerPage;

  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error("Error acquiring a connection from the pool:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query to fetch total number of orders
    const countQuery = 'SELECT COUNT(DISTINCT customer.order_id) AS total FROM customer';

    connection.query(countQuery, (error, resultCount) => {
      if (error) {
        console.error("Error counting orders:", error);
        res.status(500).send("Internal Server Error");
        return;
      }

      const totalOrders = resultCount[0].total;

      // Query to fetch orders with ordered dishes details with pagination
      const query = `
        SELECT 
          customer.order_id, 
          customer.table_num, 
          customer.order_date, 
          customer.order_status, 
          GROUP_CONCAT(CONCAT(dishes.dish_name, ' x ', kitchen.quantity)) as ordered_dishes
        FROM customer
        LEFT JOIN kitchen ON customer.order_id = kitchen.order_id
        LEFT JOIN dishes ON kitchen.dish_id = dishes.dish_id
        GROUP BY customer.order_id
        ORDER BY customer.order_date DESC
        LIMIT ${itemsPerPage} OFFSET ${offset};
      `;

      connection.query(query, (error, results, fields) => {
        // Release the connection back to the pool
        connection.release();

        if (error) {
          console.error("Error querying database:", error);
          res.status(500).send("Internal Server Error");
        } else {
          // Loop through each result to format the order_date
          results.forEach(result => {
            result.order_date = formatDateTime(result.order_date);
          });

          // Render the EJS template with the retrieved order details and pagination data
          res.render("admin-dashboard/orders.ejs", { 
            username: req.session.username, 
            orders: results,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalOrders / itemsPerPage),
            role: req.session.role
          });
        }
      });
    });
  });
});

app.get("/admin-dashboard/report", isAuthenticated, (req, res) => {
  res.render("admin-dashboard/report.ejs", { username: req.session.username, role: req.session.role });
});

app.get("/admin-dashboard/settings", isAuthenticated, (req, res) => {
  res.render("admin-dashboard/settings.ejs", { username: req.session.username, role: req.session.role });
});

app.get("/admin-dashboard/data-management", isAuthenticated, (req, res) => {
  pool.getConnection((error, connection) => {
    const query = "SELECT * FROM dishes ORDER BY dish_name";

    connection.query(query, (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
      } else {
        // Render the EJS template with the retrieved dish details
        res.render("admin-dashboard/data-management.ejs", { username: req.session.username, dishes: results, role: req.session.role });
      }
    });
  })
});

app.get("/admin-dashboard/transactions", (req, res) => {
  res.redirect("/admin-dashboard/transactions/1");
});

app.get("/admin-dashboard/transactions/:page", isAuthenticated, (req, res) => {
  
  const itemsPerPage = 10;
  const page = req.params.page || 1;
  const offset = (page - 1) * itemsPerPage;

  const query = `
    SELECT payment.payment_id, customer.customer_name, payment.card_number, payment.card_expiration_date, payment.card_holder_name, payment.upi_id, payment.payment_type, 
           payment.total_amount, payment.payment_date, payment.transaction_status
    FROM payment
    JOIN customer ON payment.payment_id = customer.payment_id
    ORDER BY payment.payment_date DESC
    LIMIT ${itemsPerPage} OFFSET ${offset};
  `;

  pool.query(query, (error, results) => {
    if (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).send('Internal Server Error');
    } else {
      // Calculate the total number of pages
      const queryCount = 'SELECT COUNT(*) AS total FROM payment;';
      pool.query(queryCount, (error, resultCount) => {
        if (error) {
          console.error('Error counting transactions:', error);
          res.status(500).send('Internal Server Error');
        } else {
          const totalTransactions = resultCount[0].total;
          const totalPages = Math.ceil(totalTransactions / itemsPerPage);
          res.render("admin-dashboard/transactions.ejs", { 
            username: req.session.username, 
            transactions: results, 
            currentPage: parseInt(page), 
            totalPages: totalPages,
            role: req.session.role
          });
        }
      });
    }
  });
});

app.get("/staff-dashboard", (req, res) => {
  res.redirect("/staff-dashboard/overview");
});

app.get("/staff-dashboard/overview", isAuthenticated, (req, res) => {
  res.render("staff-dashboard/overview.ejs", { username: req.session.username, role: req.session.role });
});

app.get("/superuser-dashboard/data-management", isAuthenticated, (req, res) => {
  res.redirect("/admin-dashboard/data-management");
});

app.get("/staff-dashboard/data-management", isAuthenticated, (req, res) => {
  pool.getConnection((error, connection) => {
    const query = "SELECT * FROM dishes ORDER BY dish_name";
    connection.query(query, (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
      } else {
        // Render the EJS template with the retrieved dish details
        res.render("staff-dashboard/data-management.ejs", { username: req.session.username, dishes: results , role: req.session.role });
      }
    });
  })
});

app.get("/staff-dashboard/orders", (req, res) => {
  res.redirect("/staff-dashboard/orders/1");
});

// Add this route to handle orders
app.get("/staff-dashboard/orders/:page", isAuthenticated, (req, res) => {
  const itemsPerPage = 10;
  const page = req.params.page;
  const offset = (page - 1) * itemsPerPage;

  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error("Error acquiring a connection from the pool:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query to fetch total number of orders
    const countQuery = 'SELECT COUNT(DISTINCT customer.order_id) AS total FROM customer';

    connection.query(countQuery, (error, resultCount) => {
      if (error) {
        console.error("Error counting orders:", error);
        res.status(500).send("Internal Server Error");
        return;
      }

      const totalOrders = resultCount[0].total;

      // Query to fetch orders with ordered dishes details with pagination
      const query = `
        SELECT 
          customer.order_id, 
          customer.table_num, 
          customer.order_date, 
          customer.order_status, 
          GROUP_CONCAT(CONCAT(dishes.dish_name, ' x ', kitchen.quantity)) as ordered_dishes
        FROM customer
        LEFT JOIN kitchen ON customer.order_id = kitchen.order_id
        LEFT JOIN dishes ON kitchen.dish_id = dishes.dish_id
        GROUP BY customer.order_id
        ORDER BY customer.order_date DESC
        LIMIT ${itemsPerPage} OFFSET ${offset};
      `;

      connection.query(query, (error, results, fields) => {
        // Release the connection back to the pool
        connection.release();

        if (error) {
          console.error("Error querying database:", error);
          res.status(500).send("Internal Server Error");
        } else {
          // Loop through each result to format the order_date
          results.forEach(result => {
            result.order_date = formatDateTime(result.order_date);
          });

          // Render the EJS template with the retrieved order details and pagination data
          res.render("staff-dashboard/orders.ejs", { 
            username: req.session.username, 
            orders: results,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalOrders / itemsPerPage),
            role: req.session.role
          });
        }
      });
    });
  });
});

app.get("/staff-dashboard/settings", isAuthenticated, (req, res) => {
  res.render("staff-dashboard/settings.ejs", { username: req.session.username, role: req.session.role });
});

// defines a route to index
app.get("/index", (req, res) => {
  res.render("home");
});

// redirects a route to home towards index
app.get(["/", "/home"], (req, res) => {
  res.redirect("/index");
});

app.get("/superuser-dashboard", (req, res) => {
  res.redirect("/superuser-dashboard/overview");
});

app.get("/superuser-dashboard/overview", isAuthenticated, (req, res) => {
  res.render("admin-dashboard/overview.ejs", { username: req.session.username, role: req.session.role });
});

app.get("/superuser-dashboard/access-control", isAuthenticated, (req, res) => {
  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error("Error acquiring a connection from the pool:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query to fetch all staff members from the "users" table excluding superusers
    const query = 'SELECT * FROM users WHERE role != "superuser" ORDER BY CASE WHEN role = "admin" THEN 0 ELSE 1 END, role';

    connection.query(query, (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
      } else {
        // Render the EJS template with the retrieved staff details
        res.render("admin-dashboard/superuser-access-control.ejs", {
          username: req.session.username,
          staff: results,
          role: req.session.role
        });
      }
    });
  });
});

app.get('/api/payment-data', isAuthenticated, (req, res) => {
  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error('Error acquiring a connection from the pool:', error);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    // Query to fetch payment data from the "payment" table
    const query = 'SELECT payment_type, SUM(total_amount) AS total_amount FROM payment GROUP BY payment_type';

    connection.query(query, (error, results, fields) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error('Error querying database:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Extract relevant data for the chart
        const labels = results.map(item => item.payment_type);
        const data = results.map(item => item.total_amount);

        // Send the payment data as JSON
        res.json({
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56'],
          }],
        });
      }
    });
  });
});

app.post('/api/add-user', isAuthenticated, (req, res) => {
  const { firstName, lastName, role, username, password } = req.body;
  // Perform the add user logic here
  pool.query(
    'INSERT INTO users (first_name, last_name, role, username, password) VALUES (?, ?, ?, ?, ?)',
    [firstName, lastName, role, username, password],
    (error, results) => {
      if (error) {
        console.error('Error adding new user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Redirect to the access-control route after adding the user
        const referer = req.get('referer');
        res.redirect(referer);
      }
    }
  );
});

app.post('/api/add-staff', isAuthenticated, (req, res) => {
  const { firstName, lastName, username, password } = req.body;
  const role ='staff';
  // Perform the add user logic here
  pool.query(
    'INSERT INTO users (first_name, last_name, role, username, password) VALUES (?, ?, ?, ?, ?)',
    [firstName, lastName, role, username, password],
    (error, results) => {
      if (error) {
        console.error('Error adding new staff:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Redirect to the access-control route after adding the user
        const referer = req.get('referer');
        res.redirect(referer);
      }
    }
  );
});

app.post('/api/update-user/:userId', isAuthenticated, (req, res) => {
  const userId = req.params.userId;
  const { firstName, lastName, role, username, password } = req.body;

  // Perform the update logic here
  pool.query(
    'UPDATE users SET first_name = ?, last_name = ?, role = ?, username = ?, password = ? WHERE user_id = ?',
    [firstName, lastName, role, username, password, userId],
    (error, results) => {
      if (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Send a success response
        const referer = req.get('referer');
        res.redirect(referer);
      }
    }
  );
});

app.post('/api/update-staff/:userId', isAuthenticated, (req, res) => {
  const userId = req.params.userId;
  const { firstName, lastName, username, password } = req.body;

  // Perform the update logic here
  pool.query(
    'UPDATE users SET first_name = ?, last_name = ?, username = ?, password = ? WHERE user_id = ?',
    [firstName, lastName, username, password, userId],
    (error, results) => {
      if (error) {
        console.error('Error updating staff:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Send a success response
        const referer = req.get('referer');
        res.redirect(referer);
      }
    }
  );
});

// Add this route to handle user removal
app.delete('/api/remove-user/:userId', isAuthenticated, (req, res) => {
  const userId = req.params.userId;

  // Perform the removal logic here, for example:
  pool.query('DELETE FROM users WHERE user_id = ?', [userId], (error, results) => {
    if (error) {
      console.error('Error removing user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      // Send a success response
      res.json({ message: 'User removed successfully' });
    }
  });
});

function formatDateTime(dateTimeString) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const dateTime = new Date(dateTimeString);
  const formattedDateTime = dateTime.toLocaleString('en-GB', options);
  return formattedDateTime.replace(/\//g, '-'); // Replace all occurrences of '/'
}

app.post('/api/update-order-status/:orderId', isAuthenticated, (req, res) => {
  const orderId = req.params.orderId;
  const { orderStatus } = req.body;

  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error('Error acquiring a connection from the pool:', error);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    // Perform the update logic here
    const query = 'UPDATE customer SET order_status = ? WHERE order_id = ?';
    connection.query(query, [orderStatus, orderId], (error, results) => {
      // Release the connection back to the pool
      connection.release();

      if (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Send a success response
        const referer = req.get('referer');
        res.redirect(referer);
      }
    });
  });
});

app.delete('/api/remove-dish/:dishId', isAuthenticated, (req, res) => {
  const dishId = req.params.dishId;

  // Check if there is a foreign key reference in the kitchen table
  const checkQuery = 'SELECT * FROM kitchen WHERE dish_id = ? LIMIT 1';
  pool.query(checkQuery, [dishId], (checkError, checkResults) => {
    if (checkError) {
      console.error('Error checking foreign key reference:', checkError);
      res.status(500).json({ error: 'Internal Server Error' });
    } else if (checkResults.length > 0) {
      // There is a foreign key reference, handle accordingly
      res.status(400).json({ error: 'Cannot remove dish. It is referenced in the kitchen table.' });
    } else {
      // No foreign key reference, proceed with deletion
      const deleteQuery = 'DELETE FROM dishes WHERE dish_id = ?';
      pool.query(deleteQuery, [dishId], (deleteError, deleteResults) => {
        if (deleteError) {
          console.error('Error removing dish:', deleteError);
          res.status(500).json({ error: 'Internal Server Error' });
        } else {
          // Send a success response
          res.json({ message: 'Dish removed successfully' });
        }
      });
    }
  });
});

app.post('/api/remove-file', async (req, res) => {
  try {
      const imagePath = req.body.imagePath;

      // Assuming the imagePath is relative to the 'public/images/uploads' directory
      const filePath = path.join(__dirname, 'public/images/uploads', imagePath);

      // Check if the file exists before attempting to delete
      const fileExists = await fs.access(filePath)
          .then(() => true)
          .catch(() => false);

      if (fileExists) {
          // Remove the file
          await fs.unlink(filePath);
          res.status(200).json({ message: 'File removed successfully' });
      } else {
          res.status(404).json({ error: 'File not found' });
      }
  } catch (error) {
      console.error('Error removing file:', error);
      res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/update-dish/:dishId', isAuthenticated, (req, res) => {
  const dishId = req.params.dishId;
  const { dishName, price, vegetarian, available, dishDescription, dishPhoto, calories, protein, fat, carb } = req.body;

  // Select the current dish_photo from the database
  pool.query(
    'SELECT dish_photo FROM dishes WHERE dish_id = ?',
    [dishId],
    (selectError, selectResults) => {
      if (selectError) {
        console.error('Error selecting dish_photo:', selectError);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        const currentDishPhoto = selectResults[0].dish_photo;

        // Perform the update logic here
        pool.query(
          'UPDATE dishes SET dish_name = ?, price = ?, vegetarian = ?, available = ?, dish_description = ?, dish_photo = ?, calories = ?, protein = ?, fat = ?, carb = ? WHERE dish_id = ?',
          [dishName, price, vegetarian, available, dishDescription, dishPhoto, calories, protein, fat, carb, dishId],
          (updateError, updateResults) => {
            if (updateError) {
              console.error('Error updating dish:', updateError);
              res.status(500).json({ error: 'Internal Server Error' });
            } else {
              // If dishPhoto is updated, delete the old image file
              if (currentDishPhoto && currentDishPhoto !== dishPhoto) {
                // Use fs.unlink to delete the old image file
                fs.unlink(path.join(__dirname, "public/images/uploads", currentDishPhoto), (unlinkError) => {
                  if (unlinkError) {
                    console.error('Error deleting old image file:', unlinkError);
                  } else {
                    console.log('Old image file deleted successfully');
                  }
                });
              }

              // Send a success response
              const referer = req.get('referer');
              res.redirect(referer);
            }
          }
        );
      }
    }
  );
});

app.post('/api/add-dish',isAuthenticated, (req, res) => {
  const { dishName, price, vegetarian, available, dishDescription, dishPhoto, calories, protein, fat, carb } = req.body;
  pool.query(
    'INSERT INTO dishes (dish_name, price, vegetarian, available, dish_description, dish_photo, calories, protein, fat, carb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [dishName, price, vegetarian, available, dishDescription, dishPhoto, calories, protein, fat, carb],
    (error, results) => {
      if (error) {
        console.error('Error adding new dish:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        // Send a success response
        const referer = req.get('referer');
        res.redirect(referer);
      }
    }
  );
})

// defines a route to menu
app.get("/menu/:table_num", (req, res) => {
  const tableNumber = req.params.table_num;

  // Acquire a connection from the pool
  pool.getConnection((error, connection) => {
    if (error) {
      console.error("Error acquiring a connection from the pool:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    // Query to fetch all dishes
    const dishesQuery = "SELECT * FROM dishes";

    // Query to fetch restaurant information
    const restaurantQuery = "SELECT * FROM restaurant";

    // Query to fetch all categories
    const categoriesQuery = "SELECT * FROM categories";

    // Execute queries in parallel using nested callbacks
    connection.query(dishesQuery, (error, dishesResults) => {
      if (error) {
        console.error("Error querying dishes:", error);
        connection.release();
        res.status(500).send("Internal Server Error");
        return;
      }

      connection.query(restaurantQuery, (error, restaurantResults) => {
        if (error) {
          console.error("Error querying restaurant:", error);
          connection.release();
          res.status(500).send("Internal Server Error");
          return;
        }

        connection.query(categoriesQuery, (error, categoriesResults) => {
          if (error) {
            console.error("Error querying categories:", error);
            connection.release();
            res.status(500).send("Internal Server Error");
            return;
          }

          // Release the connection back to the pool
          connection.release();

          // Render the EJS template with the retrieved data
          res.render("menu", {
            dishes: dishesResults,
            restaurant: restaurantResults[0],
            categories: categoriesResults,
            table_num: tableNumber,
            role: req.session.role
          });
        });
      });
    });
  });
});


// defines a route to the payment gateway
app.get("/payment", (req, res) => {
  res.render("payment-gateway");
});

// defines a route to the payment successful page
app.get("/payment-succesful", (req, res) => {
  res.render("payment-successful");
});

app.get("/staff-dashboard", (req, res) => {
  // Render the staff dashboard view
  res.render("staff-dashboard");
});

// response if the server is successfully running
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
