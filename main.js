const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const axios = require("axios");
require("dotenv").config();
const { exec } = require("child_process");
const multer = require("multer")
const app = express();

app.disable("x-powered-by");
app.use("/", router);

const port = process.env.PORT || 3000

router.get("/", async (req, res) => {
  return res.send("API Documentation below. ")
});
//hm
app.get("/pac", (req, res) => {
  res.send(`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`);
});

app.get("/check-cert", async (req, res) => {
  const certsPath = path.join(__dirname, "files", "certs");
  const p12Path = path.join(certsPath, "downloaded.p12"); // Filename for the downloaded .p12 file

  try {
    // Ensure the certs directory exists
    if (!fs.existsSync(certsPath)) {
      fs.mkdirSync(certsPath, { recursive: true });
    }

    // GitHub API URL to fetch file content
    const apiUrl = `https://api.github.com/repos/loyahdev/certificates/contents/Certificates.p12`;

    // Set up the headers for the GitHub request
    const headers = {
      'Authorization': `token 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`,
      'Accept': 'application/vnd.github.v3.raw' // Ensures you get the raw file content
    };

    // Download the .p12 file with the GitHub access key
    const response = await axios.get(apiUrl, {
      headers: headers,
      responseType: "arraybuffer"
    });
    fs.writeFileSync(p12Path, response.data);

    // Run the Python script with the downloaded .p12 file as an argument
    exec(`python3 cert-validator.py "${p12Path}" "Hydrogen"`, async (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return res.status(400).json({ error: stderr || error.message });
      }

      try {
        // Extract and parse the JSON part of stdout
        const jsonStartIndex = stdout.lastIndexOf('{');
        const jsonString = stdout.substring(jsonStartIndex);
        const parsedOutput = JSON.parse(jsonString);

        try {
          // Check if the file exists in the repository
          let sha;
          let blacklisting = "Unknown"; // Default value for blacklisting

          try {
            const response = await octokit.repos.getContent({
              owner: "loyahdev",
              repo: "certificates",
              path: "status.json"
            });
            sha = response.data.sha; // If file exists, get its SHA to update it

            // Extract blacklisting property from existing content
            const existingContent = Buffer.from(response.data.content, 'base64').toString();
            const existingData = JSON.parse(existingContent);
            blacklisting = existingData.blacklisting;
          } catch (error) {
            if (error.status !== 404) {
              throw error; // Rethrow error if it's not 'Not Found'
            }
            // File does not exist, proceed to create it with default blacklisting
          }

          // Update parsedOutput with the blacklisting value
          parsedOutput.blacklisting = blacklisting;

          // Convert JSON data to string and encode in base64
          var content = Buffer.from(JSON.stringify(parsedOutput, null, 2)).toString('base64');

          // Create or update the file
          await octokit.repos.createOrUpdateFileContents({
            owner: "loyahdev",
            repo: "certificates",
            path: "status.json",
            message: "API: Update certificate",
            content: content,
            sha // If undefined, a new file will be created
          });

          console.log('File uploaded successfully');
        } catch (error) {
          console.error('Error uploading file:', error);
        }

        // Send back the parsed JSON
        res.json(parsedOutput);
      } catch (parseError) {
        console.error(`JSON parsing error: ${parseError}`);
        res.status(500).json({ error: "Failed to parse script output as JSON" });
      }
    });
  } catch (downloadError) {
    console.error(`Error: ${downloadError}`);
    res.status(500).json({ error: "Failed to download or process the certificate" });
  }
});

const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: `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`,
});

async function createGitHubRelease(tagName, releaseName, description, zipFilePath) {
  const owner = "loyahdev";
  const repo = "certificates";

  // Check if a release with the same tag already exists
  const releases = await octokit.repos.listReleases({
    owner,
    repo
  });

  const existingRelease = releases.data.find(release => release.tag_name === tagName);

  // If it exists, delete it
  if (existingRelease) {
    await octokit.repos.deleteRelease({
      owner,
      repo,
      release_id: existingRelease.id,
    });
  }

  // Create a new release
  const release = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: tagName,
    name: releaseName,
    body: description,
  });

  // Upload an asset
  const contentLength = fs.statSync(zipFilePath).size;
  const contentStream = fs.createReadStream(zipFilePath);

  await octokit.repos.uploadReleaseAsset({
    url: release.data.upload_url,
    headers: {
      "content-type": "application/zip",
      "content-length": contentLength,
    },
    name: path.basename(zipFilePath),
    data: contentStream,
  });
}

const archiver = require("archiver");

function zipFiles(files, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    files.forEach((file) => archive.file(file.path, { name: file.name }));
    archive.finalize();
  });
}

// Configure multer storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Endpoint to add certification
app.post("/add-cert", upload.fields([{ name: 'mobileprovision' }, { name: 'p12' }]), (req, res) => {
  // Extract files and password from the request
  const mobileprovisionFile = req.files ? req.files.mobileprovision[0] : null;
  const p12File = req.files ? req.files.p12[0] : null;
  const old_password = req.body.cert_password;

  // Check if all required parts are present
  if (!mobileprovisionFile || !p12File || !old_password) {
    return res.status(400).send("Missing files or password");
  }

  // Define paths for the saved files
  const certsPath = path.join(__dirname, "files", "certs");
  const mobileprovisionPath = path.join(certsPath, mobileprovisionFile.originalname);
  const p12Path = path.join(certsPath, p12File.originalname);

  // Ensure the certs directory exists
  if (!fs.existsSync(certsPath)) {
    fs.mkdirSync(certsPath, { recursive: true });
  }

  // Save the uploaded files
  fs.writeFileSync(mobileprovisionPath, mobileprovisionFile.buffer);
  fs.writeFileSync(p12Path, p12File.buffer);

  // Execute Python script to check password
  exec(`python3 password-checker.py "${p12Path}" "${old_password}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing password-checker script: ${error}`);
      console.error(`password-checker STDERR: ${stderr}`);
      return res.status(500).send(`Error executing password-checker script: ${stderr}`);
    }

    console.log(`password-checker STDOUT: ${stdout}`);
    if (stdout.trim() === "True") {
      // Execute Python script to modify the p12 file
      exec(`python3 change-password.py "${p12Path}" "${old_password}" "Hydrogen" "${p12Path}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing change-password script: ${error}`);
          console.error(`change-password STDERR: ${stderr}`);
          return res.status(500).send(`Error executing change-password script: ${stderr}`);
        }

        console.log(`change-password STDOUT: ${stdout}`);
        // Run the Python script using the exec command
        exec(`python3 cert-validator.py "${p12Path}" "Hydrogen"`, async (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error}`);
            return res.status(400).json({ error: stderr || error.message });
          }
          try {
            // Find the start of the JSON part
            const jsonStartIndex = stdout.indexOf('{"status":');
            if (jsonStartIndex === -1) {
              throw new Error("JSON output not found in stdout");
            }

            // Extract the JSON string
            const jsonString = stdout.substring(jsonStartIndex);
            const parsedOutput = JSON.parse(jsonString.trim());
            const certValue = parsedOutput.cert;
            console.log("parsed: " + parsedOutput);
            console.log("cert" + certValue);
            const zipPath = path.join(certsPath, certValue + ".zip");
            const passwordFilePath = path.join(certsPath, "password.txt");
            fs.writeFileSync(passwordFilePath, "Hydrogen");
            const filesToZip = [
              { path: mobileprovisionPath, name: mobileprovisionFile.originalname },
              { path: p12Path, name: p12File.originalname },
              { path: passwordFilePath, name: "password.txt" },
            ];
            await zipFiles(filesToZip, zipPath);
            const tag_name = certValue
              .replace(/\./g, "")
              .replace(/,/g, "")
              .replace(/\s/g, "-")
              .replace(/\\/g, "")
              .replace(".", "");

            const cert_description = `
Issuer: ${parsedOutput.issuer}
Subject: ${parsedOutput.subject}
Valid From: ${parsedOutput.date}
Valid Until: ${parsedOutput.expire}
Revoked: ${parsedOutput.bool_revoked_status}
            `;

            console.log("desc" + cert_description);
            await createGitHubRelease(
              tag_name,
              certValue,
              cert_description,
              zipPath
            );

            var content = fs.readFileSync(p12Path, "base64");
            const fileName = "Certificates.p12";

            try {
              let sha = null;

              try {
                const fileData = await octokit.repos.getContent({
                  owner: "loyahdev",
                  repo: "certificates",
                  path: "" + fileName,
                });
                sha = fileData.data.sha;
              } catch (error) {
                if (error.status !== 404) {
                  throw error;
                }
              }

              const params = {
                owner: "loyahdev",
                repo: "certificates",
                path: "" + fileName,
                message: "API: Update certificate",
                content: content,
              };

              if (sha) {
                params.sha = sha;
              }

              const result = await octokit.repos.createOrUpdateFileContents(params);
            } catch (error) {
              console.error("Failed to upload file to GitHub:", error);
              throw error;
            }

            const contentprov = fs.readFileSync(mobileprovisionPath, "base64");
            const fileNameprov = "Certificates.mobileprovision";

            try {
              let sha = null;

              try {
                const fileData = await octokit.repos.getContent({
                  owner: "loyahdev",
                  repo: "certificates",
                  path: "" + fileNameprov,
                });
                sha = fileData.data.sha;
              } catch (error) {
                if (error.status !== 404) {
                  throw error;
                }
              }

              const params = {
                owner: "loyahdev",
                repo: "certificates",
                path: "" + fileNameprov,
                message: "API: Update certificate",
                content: contentprov,
              };

              if (sha) {
                params.sha = sha;
              }

              const result = await octokit.repos.createOrUpdateFileContents(params);
            } catch (error) {
              console.error("Failed to upload file to GitHub:", error);
              throw error;
            }

            // Send the parsed data back to the client as JSON
            res.status(200).json({ message: "Certificate changed successfully." });

            try {
              // Check if the file exists in the repository
              let sha;
              let blacklisting = "Unknown"; // Default value for blacklisting

              try {
                const response = await octokit.repos.getContent({
                  owner: "loyahdev",
                  repo: "certificates",
                  path: "status.json"
                });
                sha = response.data.sha; // If file exists, get its SHA to update it

                // Extract blacklisting property from existing content
                const existingContent = Buffer.from(response.data.content, 'base64').toString();
                const existingData = JSON.parse(existingContent);
                blacklisting = existingData.blacklisting;
              } catch (error) {
                if (error.status !== 404) {
                  throw error; // Rethrow error if it's not 'Not Found'
                }
                // File does not exist, proceed to create it with default blacklisting
              }

              // Update parsedOutput with the blacklisting value
              parsedOutput.blacklisting = blacklisting;

              // Convert JSON data to string and encode in base64
              var content = Buffer.from(JSON.stringify(parsedOutput, null, 2)).toString('base64');

              // Create or update the file
              await octokit.repos.createOrUpdateFileContents({
                owner: "loyahdev",
                repo: "certificates",
                path: "status.json",
                message: "API: Update certificate",
                content: content,
                sha // If undefined, a new file will be created
              });

              console.log('File uploaded successfully');

              // Ensure /certs/signed directory exists in the repository
              try {
                await octokit.repos.createOrUpdateFileContents({
                  owner: "loyahdev",
                  repo: "certificates",
                  path: "certs/signed/.gitkeep",
                  message: "Ensure /certs/signed directory exists",
                  content: Buffer.from("").toString("base64"),
                });
              } catch (error) {
                if (error.status !== 422) { // Ignore 422 Unprocessable Entity error if the file already exists
                  throw error;
                }
              }

              // Upload the zipped file to GitHub
              var content = fs.readFileSync(zipPath, "base64");
              await octokit.repos.createOrUpdateFileContents({
                owner: "loyahdev",
                repo: "certificates",
                path: `certs/signed/${certValue}.zip`,
                message: "Upload signed certificate",
                content: content,
              });

              console.log('File uploaded successfully');

              const url = 'https://discord.com/api/webhooks/1246310601177829496/1c9Osl3Y4IGVU1QFaVNwYQr1FlT_dHLGzSPblsu60qmt4vcdK03YD2pItzWhwxc18M0C';
              const data = {
                content: 'thirdstore cert api is working',
                embeds: null,
                attachments: []
              };

              axios.post(url, data)
                .then(response => {
                  console.log(`Status: ${response.status}`);
                  console.log('Body: ', response.data);
                })
                .catch(error => {
                  console.error('Error: ', error.response ? error.response.data : error.message);
                });

              res.status(200).json({ message: "Certificate changed successfully." });
            } catch (error) {
              console.error('Error uploading file:', error);
              res.status(500).json({ error: "Failed to upload to Github API error" });
            }

            fs.unlinkSync(passwordFilePath);
            fs.unlinkSync(zipPath);
            fs.unlinkSync(mobileprovisionPath);
            fs.unlinkSync(p12Path);
          } catch (parseError) {
            // Handle JSON parsing errors
            console.error(`JSON parsing error: ${parseError}`);
            res.status(500).json({ error: "Failed to parse script output as JSON" });
          }
        });
      });
    } else if (stdout.trim() === "False") {
      res.status(500).send("Certificate password is incorrect");
    } else {
      res.status(500).send("Unexpected script output");
    }
  });
});

const getRevokedFileListFromGitHub = async () => {
  console.log("Request received and sending...");
  const apiUrl = 'https://api.github.com/repos/loyahdev/certificates/contents/certs/revoked';
  try {
    const response = await axios.get(apiUrl);
    return response.data.map(file => ({
      name: file.name,
      download_url: file.download_url,
    }));
  } catch (error) {
    console.error('Error fetching file list from GitHub:', error);
    return [];
  }
};

const getSignedFileListFromGitHub = async () => {
  console.log("Request received and sending...");
  const apiUrl = 'https://api.github.com/repos/loyahdev/certificates/contents/certs/signed';
  try {
    const response = await axios.get(apiUrl);
    return response.data.map(file => ({
      name: file.name,
      download_url: file.download_url,
    }));
  } catch (error) {
    console.error('Error fetching file list from GitHub:', error);
    return [];
  }
};

const getAllCertFileListFromGitHub = async () => {
  try {
    const [revokedFiles, signedFiles] = await Promise.all([
      getRevokedFileListFromGitHub(),
      getSignedFileListFromGitHub()
    ]);

    return [...revokedFiles, ...signedFiles];
  } catch (error) {
    console.error('Error fetching all certificate files from GitHub:', error);
    return [];
  }
};

app.get('/revoked', async (req, res) => {
  const files = await getRevokedFileListFromGitHub();
  res.json(files);
});

app.get('/signed', async (req, res) => {
  const files = await getSignedFileListFromGitHub();
  res.json(files);
});

app.get('/all-certs', async (req, res) => {
  const files = await getAllCertFileListFromGitHub();
  res.json(files);
});

app.get('/download-signed', async (req, res) => {
  try {
    const files = await getSignedFileListFromGitHub();
    if (files.length > 0) {
      return res.redirect(files[0].download_url);
    } else {
      return res.status(404).send("No signed certificates found.");
    }
  } catch (error) {
    console.error('Error fetching signed certificates:', error);
    return res.status(500).send("Internal server error");
  }
});

app.get('/test', async (req, res) => {
  const url = 'https://discord.com/api/webhooks/1246310601177829496/1c9Osl3Y4IGVU1QFaVNwYQr1FlT_dHLGzSPblsu60qmt4vcdK03YD2pItzWhwxc18M0C';
  const data = {
    content: 'thirdstore cert api is working',
    embeds: null,
    attachments: []
  };

  axios.post(url, data)
    .then(response => {
      console.log(`Status: ${response.status}`);
      console.log('Body: ', response.data);
    })
    .catch(error => {
      console.error('Error: ', error.response ? error.response.data : error.message);
    });

    return res.status(200).send("API worked succesfully");
});


app.listen(port, () => {
  console.log(`ThirdStore Certificates API listening at 0.0.0.0:${port}`);
});
