import fs from "fs-extra";
import path from "node:path";
import {execFile} from "node:child_process";
import archiver from "archiver";
import extractZip from "extract-zip";
import {Program, ProgramInfo, ProgramProcess, ProgramSummary} from "dostron/types";

export function discoverPrograms(dir: string): Program[] {
    return fs.readdirSync(dir, {withFileTypes: true})
        .filter(dirent => dirent.isDirectory())
        .map(dirent => loadProgram(path.join(dir, dirent.name)));
}

function loadProgram(dir: string): Program {
    return <Program>{
        id: path.basename(dir),
        dir,
        info: loadProgramInfo(dir),
        cover: locateProgramCover(dir)
    };
}

function loadProgramInfo(dir: string): ProgramInfo {
    const filePath = path.resolve(getDataDirectoryPath(dir), "info.json");
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, {encoding: "utf-8"})) : <ProgramInfo>{name: path.basename(dir)};
}

function getDataDirectoryPath(base: string): string {
    return path.resolve(base, ".dostron");
}

function locateProgramCover(dir: string): string | undefined {
    const filePath = path.resolve(getDataDirectoryPath(dir), "cover.png");
    return fs.existsSync(filePath) ? filePath : undefined;
}

export async function archiveProgram(program: Program, target: string): Promise<void> {
    if (fs.existsSync(target)) {
        throw new Error(`File "${target}" already exists.`);
    }

    const output = fs.createWriteStream(target);
    const archive = archiver.create("zip", {
        zlib: {level: 9}
    });

    archive.pipe(output);
    archive.directory(program.dir, false);

    await archive.finalize();
}

export async function extractProgramArchive(archive: string, target: string): Promise<Program> {
    if (fs.existsSync(target)) {
        throw new Error(`Directory "${target}" already exists.`);
    }

    await extractZip(archive, {dir: target});
}

export function getProgramSummary(root: string, program: Program): ProgramSummary | undefined {
    const filePath = path.resolve(root, `${program.id}.json`);

    if (!fs.existsSync(filePath)) {
        return undefined;
    }

    const summary = fs.readJSONSync(filePath);
    summary.lastRun = new Date(summary.lastRun);

    return summary;
}

export function setProgramSummary(root: string, program: Program, summary: ProgramSummary) {
    const filePath = path.resolve(root, `${program.id}.json`);
    fs.writeJSONSync(filePath, summary);
}

export function restoreProgramStates(dir: string, program: Program) {
    if (!fs.existsSync(dir)) {
        return;
    }

    const listFiles = (dir: string) => {
        let files = new Array<string>();

        fs.readdirSync(dir).forEach(file => {
            const filePath = path.resolve(dir, file);
            const states = fs.statSync(filePath);

            if (states.isDirectory()) {
                files = files.concat(listFiles(filePath));
            }

            if (states.isFile()) {
                files.push(filePath);
            }
        });

        return files;
    };

    listFiles(dir).forEach(file => {
        const relativePath = file.replace(dir, "");
        const targetPath = path.join(program.dir, relativePath);

        fs.copySync(file, targetPath);
    });
}

export class ProcessManager {
    public readonly processes: ProgramProcess[] = [];

    public runProgram(program: Program, dosbox: string): ProgramProcess {
        const args = [
            "-conf",
            path.resolve(program.dir, ".dostron", "dosbox.conf")
        ];

        const process = <ProgramProcess>execFile(dosbox, args, {cwd: program.dir});
        process.program = program;

        process.on("exit", () => {
            this.removeProcessByPid(process.pid);
        });

        this.processes.push(process);

        return process;
    }

    public findProcessByPid(pid: number): ProgramProcess | undefined {
        return this.processes.find(process => process.pid === pid);
    }

    public findProcessByProgram(program: Program): ProgramProcess | undefined {
        return this.processes.find(process => process.program.id === program.id);
    }

    public killProcessByPid(pid: number) {
        const process = this.findProcessByPid(pid);

        if (!process) {
            throw new Error(`Process #${pid} not found.`);
        }

        process.kill();

        this.removeProcessByPid(process.pid);
    }

    public killProcessByProgram(program: Program) {
        const process = this.findProcessByProgram(program);

        if (!process) {
            throw new Error(`Process of program #${program.id} not found.`);
        }

        this.killProcessByPid(process.pid);
    }

    private removeProcessByPid(pid: number) {
        const i = this.processes.findIndex(el => el.pid === pid);

        if (i > -1) {
            this.processes.splice(i, 1);
        }
    }
}
