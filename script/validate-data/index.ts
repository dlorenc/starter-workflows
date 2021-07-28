#!/usr/bin/env npx ts-node
import { promises as fs } from "fs";
import { safeLoad } from "js-yaml";
import { basename, extname, join } from "path";
import { Validator as validator } from "jsonschema";
import { endGroup, error, info, setFailed, startGroup } from '@actions/core';
import { performance } from 'perf_hooks';

interface WorkflowWithErrors {
  id: string;
  errors: string[];
}

interface WorkflowProperties {
  name: string;
  description: string;
  iconName: string;
  categories: string[];
}

const propertiesSchema = {
  type: "object",
  properties: {
    name: { type: "string", required: true },
    description: { type: "string", required: true },
    creator: { type: "string", required: false },
    iconName: { type: "string", required: true },
    categories: {
      anyOf: [
        {
          type: "array",
          items: { type: "string" }
        },
        {
          type: "null",
        }
      ],
      required: true
    },
  }
}
async function checkWorkflows(folders: string[]): Promise<WorkflowWithErrors[]> {
  const result: WorkflowWithErrors[] = []

  for (const folder of folders) {
    const dir = await fs.readdir(folder, {
      withFileTypes: true,
    });

    for (const e of dir) {
      if (e.isFile()) {
        const fileType = basename(e.name, extname(e.name))

        const workflowFilePath = join(folder, e.name);
        const propertiesFilePath = join(folder, "properties", `${fileType}.properties.json`)

        const errors = await checkWorkflow(workflowFilePath, propertiesFilePath);
        if (errors.errors.length > 0) {
          result.push(errors)
        }
      }
    }
  }

  return result;
}

async function validateWorkflowProperties(propertiesPath: string) : Promise<string[]> {
  try {
    let errors = []
    const propertiesFileContent = await fs.readFile(propertiesPath, "utf8")
    const properties: WorkflowProperties = JSON.parse(propertiesFileContent)

    let v = new validator();
    const res = v.validate(properties, propertiesSchema)
    errors = res.errors.map(e => e.toString())
    if (properties.iconName && !properties.iconName.startsWith("octicon")) {
      try {
        await fs.access(`../../icons/${properties.iconName}.svg`)
      } catch (e) {
        errors.push(`No icon named ${properties.iconName} found`)
      }
    }
    return errors
  }
  catch (e) {
    throw e
  }
}

async function checkWorkflow(workflowPath: string, propertiesPath: string): Promise<WorkflowWithErrors> {
  let workflowErrors: WorkflowWithErrors = {
    id: workflowPath,
    errors: []
  }

  try {
    workflowErrors.errors = await validateWorkflowProperties(propertiesPath)

    const workflowFileContent = await fs.readFile(workflowPath, "utf8");
    const workflow = safeLoad(workflowFileContent); // Validate yaml parses without error
    
    let workflowValidator = new validator();
    const workflowSchema = require("./workflow-schema.json");
    
    const workflowValidationResult = workflowValidator.validate(workflow, workflowSchema)
    const workflowValidationErrors = workflowValidationResult.errors.map(e => e.toString())
    workflowErrors.errors = workflowErrors.errors.concat(workflowValidationErrors)
    
  } catch (e) {
    workflowErrors.errors.push(e.toString())
  }
  return workflowErrors;
}

(async function main() {
  try {
    const settings = require("./settings.json");
    var t0 = performance.now()
    const erroredWorkflows = await checkWorkflows(
      settings.folders
    )
    var t1 = performance.now()
    info("Call to checkWorkflows took " + (t1 - t0) + " milliseconds.")

    if (erroredWorkflows.length > 0) {
      startGroup(`😟 - Found ${erroredWorkflows.length} workflows with errors:`);
      erroredWorkflows.forEach(erroredWorkflow => {
        error(`Errors in ${erroredWorkflow.id} - ${erroredWorkflow.errors.map(e => e.toString()).join(", ")}`)
      })
      endGroup();
      setFailed(`Found ${erroredWorkflows.length} workflows with errors`);
    } else {
      info("🎉🤘 - Found no workflows with errors!")
    }
  } catch (e) {
    error(`Unhandled error while syncing workflows: ${e}`);
    setFailed(`Unhandled error`)
  }
})();