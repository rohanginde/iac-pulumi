const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();


const availabilityZoneCount = config.getNumber("availabilityZoneCount");
const vpcCidrBlock = config.require("vpcCidrBlock");
const cidrBlock = config.require("cidrBlock");
const publicSubnets = [];
const privateSubnets = [];





const subnetSuffix = config.require("subnetSuffix");

const state = config.require("state");
const vpcName = config.require("vpcName");
const igwName = config.require("igwName");
const publicSta = config.require("public");


const destinationCidr = config.require("destinationCidr");
const public_route_association = config.require("public-route-association");
const private_route_association = config.require("private-route-association");
const privateSta = config.require("private");

const public_Subnet = config.require("publicsubnet");
const private_Subnet = config.require("privatesubnet");

const public_rt = config.require("public-rt");
const private_rt = config.require("private-rt");
const public_Route = config.require("publicRoute");




// Define a function to get the first N availability zones
function getFirstNAvailabilityZones(data, n) {
    const availableAZCount = data.names.length;

    if (availableAZCount >= n) {
        return data.names.slice(0, n);
    } 
    else {
    
        return data.names;
    }
}

const availabilityZoneNames = []; // Initialize an array to store availability zone names

aws.getAvailabilityZones({ state: `${state}` }).then(data => {
    const availabilityZones = getFirstNAvailabilityZones(data, availabilityZoneCount); // Choose the first 3 AZs if available AZs are greater than 3
    const vpc = new aws.ec2.Vpc(`${vpcName}`, {
        cidrBlock: `${vpcCidrBlock}`,
        availabilityZones: availabilityZones,
    });
    const internetGateway = new aws.ec2.InternetGateway(`${igwName}`, {
        vpcId: vpc.id, // Associate the Internet Gateway with the VPC
    });

    for (let i = 0; i < availabilityZones.length; i++) {
        const az = availabilityZones[i];
        availabilityZoneNames.push(az);
    }
    const calculateCidrBlock = (index, subnetType) => {
        const subnetNumber = subnetType === `${publicSta}` ? index : index + availabilityZoneCount;
        return `${cidrBlock}.${subnetNumber}${subnetSuffix}`;
    };

    // Create subnets within each availability zone
    for (let i = 0; i < availabilityZoneNames.length; i++) {
        const az = availabilityZoneNames[i];

        // Create public and private subnets using aws.ec2.Subnet
        const publicSubnet = new aws.ec2.Subnet(`${public_Subnet}-${az}-${i}`, {
            vpcId: vpc.id,
            cidrBlock: calculateCidrBlock(i,`${publicSta}`),
            availabilityZone: az,
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `${public_Subnet}`,
            },
        });

        const privateSubnet = new aws.ec2.Subnet(`${private_Subnet}-${az}-${i}`, {
            vpcId: vpc.id,
            cidrBlock: calculateCidrBlock(i,`${privateSta}`),
            availabilityZone: az,
            tags: {
                Name: `${private_Subnet}`,
            },
        });

        publicSubnets.push(publicSubnet);
        privateSubnets.push(privateSubnet);
    }

    const publicRouteTable = new aws.ec2.RouteTable(`${public_rt}`, {
        vpcId: vpc.id,
        tags: {
            Name: `${public_rt}`,
        },
    });

    const privateRouteTable = new aws.ec2.RouteTable(`${private_rt}`, {
        vpcId: vpc.id,
        tags: {
            Name: `${private_rt}`,
        },
    });
    const publicRoute = new aws.ec2.Route(`${public_Route}`, {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: `${destinationCidr}`,
        gatewayId: internetGateway.id,
    });

    // Associate the public subnets with the public route table
    publicSubnets.forEach((subnet,i) => {
        new aws.ec2.RouteTableAssociation(`${public_route_association}-${subnet.availabilityZone}-${i}`, {
            subnetId: subnet.id,
            routeTableId: publicRouteTable.id,
            tags:{
                Name: `${public_route_association}`,
            },
        });
    });

    // Associate the private subnets with the private route table
    privateSubnets.forEach((subnet,i) => {
        new aws.ec2.RouteTableAssociation(`${private_route_association}-${subnet.availabilityZone}-${i}`, {
            subnetId: subnet.id,
            routeTableId: privateRouteTable.id,
            tags:{
                Name: `${private_route_association}`,
            },
        });
    });
});