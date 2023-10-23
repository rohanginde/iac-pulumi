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
const owner = config.require("owner");

// Define a function to get the first N availability zones
function getFirstNAvailabilityZones(data, n) {
  const availableAZCount = data.names.length;

  if (availableAZCount >= n) {
    return data.names.slice(0, n);
  } else {
    return data.names;
  }
}

const availabilityZoneNames = []; // Initialize an array to store availability zone names
async function getAMIObject() {


  const latestAmi = await aws.ec2.getAmi({
    owners: [owner],
    filters: [
      {
        name: "state",
        values: ["available"],
      },
    ],

    mostRecent: true,
  });

  //const amiId =  await latestAmi.then(result => result.ids[0]);

  //logMessage(amiId)
  return latestAmi.id;
}
aws.getAvailabilityZones({ state: `${state}` }).then((data) => {
  const availabilityZones = getFirstNAvailabilityZones(
    data,
    availabilityZoneCount
  ); // Choose the first 3 AZs if available AZs are greater than 3
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
    const subnetNumber =
      subnetType === `${publicSta}` ? index : index + availabilityZoneCount;
    return `${cidrBlock}.${subnetNumber}${subnetSuffix}`;
  };

  // Create subnets within each availability zone
  for (let i = 0; i < availabilityZoneNames.length; i++) {
    const az = availabilityZoneNames[i];

    // Create public and private subnets using aws.ec2.Subnet
    const publicSubnet = new aws.ec2.Subnet(`${public_Subnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calculateCidrBlock(i, `${publicSta}`),
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: {
        Name: `${public_Subnet}`,
      },
    });

    const privateSubnet = new aws.ec2.Subnet(`${private_Subnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calculateCidrBlock(i, `${privateSta}`),
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
  publicSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${public_route_association}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: publicRouteTable.id,
        tags: {
          Name: `${public_route_association}`,
        },
      }
    );
  });

  // Associate the private subnets with the private route table
  privateSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${private_route_association}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
        tags: {
          Name: `${private_route_association}`,
        },
      }
    );
  });

  const vpcId = vpc.id;

  // Define the name for the EC2 instance
  const instanceName = "MyEC2Instance";

  // Create a security group for the EC2 instance
  const securityGroup = new aws.ec2.SecurityGroup(
    "application-security-group",
    {
      vpcId: vpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrBlocks: ["0.0.0.0/0"],
        },
        {
          protocol: "tcp",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
        },
        {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrBlocks: ["0.0.0.0/0"],
        },
        {
          protocol: "tcp",
          fromPort: 3000,
          toPort: 3000,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    }
  );

  // Fetch the region and operating system from the loaded configuration

  const ec2Instance = new aws.ec2.Instance(instanceName, {
    ami: getAMIObject(), // Replace 'your_custom_ami_id' with the ID of your custom AMI.
    instanceType: "t2.micro", // Replace with the desired instance type.
    vpcSecurityGroupIds: [securityGroup.id],
    associatePublicIpAddress: true,
    subnetId: publicSubnets[0].id,
    // Replace 'your_subnet_id' with the desired subnet ID.
    keyName: "ec2-instance-us-east-1",
    tags: { Name: instanceName },
    rootBlockDevice: {
      volumeSize: 25, // Replace with the desired root volume size (in GB).
      volumeType: "gp2", // Specify the root volume type as General Purpose SSD (GP2).
      deleteOnTermination: false, // Protect against accidental termination by setting this to false.
    },
  });
});
